/**
 * Surface shading resolver (FASI 5, 6, 7, 8, 20, 22, 54, 64).
 *
 * This is the module that decides what the dot actually looks like. It:
 *
 *   1. reads the real projected surface of the fork (blobSurfaceField);
 *   2. builds a camera-anchored light rig (blobLights);
 *   3. evaluates the full formula on a grid of screen positions;
 *   4. turns the sampled diffuse field into densely sampled OKLab gradients.
 *
 * The decisive difference from the previous engine is step 3 combined with
 * step 4. The old code sampled 14 points along a single axis and drew a radial
 * gradient: the result was, by construction, a gradient. Sampling the field
 * across the whole silhouette and interpolating per direction is what makes
 * the volume read as a lit surface rather than as a fill.
 *
 * Geometry resolution and material resolution are separate (FASI 20): the
 * silhouette can stay cheap while the shading grid gets as fine as the quality
 * level allows.
 */

import type { AvatarPose, SurfaceConfig } from '@bible-strong/avatar-core'

import { buildColorFields, type ColorField } from './blobColorFields'
import { mixColors, mixOklab, shiftColor } from './blobColor'
import { createLightRig, shadeSurface, type LightRig, type SurfaceShading } from './blobLights'
import type { BlobMaterialDefinition } from './blobMaterial'
import {
  buildSurfaceField,
  deformNormal,
  edgeDistanceAt,
  normalAtScreenPoint,
  sampleSurfaceVariation,
  type SurfaceField,
} from './blobSurfaceField'
import { clamp01, lerp } from './blobUtils'
import type { BlobLightingConfig, RenderQuality } from './blobTypes'

export type GradientStop = {
  offset: number
  color: string
  opacity: number
}

export type RadialLayer = {
  cx: number
  cy: number
  radius: number
  fx: number
  fy: number
  stops: GradientStop[]
}

export type BlobLightVector = { x: number; y: number; z: number }

export type BlobLightingDefinition = {
  light: BlobLightVector
  /** Radians; direction the key light travels from, in camera space. */
  azimuth: number
  axisX: number
  axisY: number
  rig: LightRig
  /**
   * The lit body.
   *
   * A *linear* ramp along the key light axis, not a radial one. A sphere lit
   * from one side is dark on the shadowed limb, mid at the pole and bright on
   * the lit limb, and that variation runs along the axis. A radial gradient
   * centred on the highlight cannot express it: the same radius is bright on
   * the lit side and dark on the other, so a single radial ramp either
   * collapses to a flat tint or doubles back on itself. The radial structure
   * that a disc genuinely does have is supplied separately by the colour
   * fields and the core shadow.
   */
  volume: LinearLayer
  /** Deepening pass opposite the key light. */
  coreShadow: RadialLayer
  /** Broad bounce from the opposite side. */
  fill: RadialLayer
  /** Directional wrap the radial ramp cannot express. */
  washLight: LinearLayer
  washShadow: LinearLayer
  rim: { color: string; width: number; opacity: number; insetFactor: number; maskAngle: number }
  cavity: { color: string; width: number; opacity: number; insetFactor: number; blur: number }
  edgeShade: { color: string; width: number; opacity: number; insetFactor: number }
  /** Specular position, derived from the half vector of the real rig. */
  specular: {
    cx: number
    cy: number
    rx: number
    ry: number
    rotation: number
    color: string
    opacity: number
  }
  sheen: { color: string; opacity: number; angle: number }
  /** Overlapping OKLab colour fields (FASI 9). */
  colorFields: ColorField[]
  /** Sampled statistics used by the tests and the debug overlay. */
  stats: {
    samples: number
    minDiffuse: number
    maxDiffuse: number
    meanCavity: number
    meanSpecular: number
    meanRim: number
  }
}

export type LinearLayer = {
  x1: number
  y1: number
  x2: number
  y2: number
  stops: GradientStop[]
}

const HALF_PI = Math.PI / 2

/** Radial samples around the silhouette when building the volume ramp. */
const ANGLE_SAMPLES = 72

/**
 * Number of shading probes per direction. This is the material resolution:
 * higher costs nothing in markup because the result is collapsed into
 * gradient stops, but it decides how faithfully the field is captured.
 */
const probesFor = (quality: RenderQuality): number =>
  quality === 'low' ? 5 : quality === 'medium' ? 8 : quality === 'high' ? 12 : 18

const focusShiftFor = (lightSpread: number): number => 0.35 + 0.3 * clamp01(lightSpread)

/**
 * Evaluates the shading formula at one screen point.
 *
 * The geometric normal is read from the projected surface, deformed by the
 * surface noise, and evaluated against the whole rig. The terms come back
 * separate because one sample feeds both the gradient stops and the stats.
 */
const shadeAt = (
  field: SurfaceField,
  material: BlobMaterialDefinition,
  rig: LightRig,
  point: { x: number; y: number },
  seed: number,
  deformation: number
): SurfaceShading => {
  const geometric = normalAtScreenPoint(field, point)
  const normal = deformNormal(
    [geometric[0], geometric[1], geometric[2]],
    point,
    field,
    seed,
    deformation
  )
  const edgeDistance = edgeDistanceAt(field, point)

  return shadeSurface({
    normal: { x: normal[0], y: normal[1], z: normal[2] },
    edgeDistance,
    curvature: field.curvature,
    rig,
    roughness: material.roughness,
    specular: material.specularStrength,
    specularPower: material.specularPower,
    sheen: material.sheen,
    sheenPower: 3.2,
    rim: 1,
    rimPower: 2.6,
    cavityStrength: 1,
    aoStrength: 0.16,
  })
}

/**
 * Resolves one shading sample to a colour.
 *
 * The order of operations is the formula, applied literally: the base colour
 * is lit, lifted toward the highlight, darkened by the cavity, drifted by the
 * macro surface variation and broken by the micro one.
 *
 * `peak` is the strongest diffuse contribution the sampled surface actually
 * receives. Normalizing against it is what makes the ramp span the whole
 * palette: any smaller reference saturates `lit` at 1 across the bright half
 * of the ramp — measured, the facing pole sits at barely half the real
 * maximum, because the key light is off to the side — and a saturated ramp is
 * shaped by the cavity and the noise instead of by the light, which is
 * measurably flatter than a plain radial gradient.
 */
const evaluateColor = (
  material: BlobMaterialDefinition,
  shading: SurfaceShading,
  variation: { macro: number; micro: number },
  peak: number
): string => {
  // 1. The base colour, lit. The sample is normalized against the strongest
  //    diffuse the surface receives, so the darkest point lands on the shadow
  //    colour and the brightest reaches the top of the palette. The mix runs
  //    through OKLab: interpolating saturated blues in sRGB walks through the
  //    cube's interior, and the interior of the cube is grey, so the ramp shed
  //    a fifth of the body's saturation on its way from shadow to highlight.
  const lit = clamp01((shading.diffuseField - shading.ambient) / peak)
  let color = mixOklab(material.palette.shadow, material.palette.base, lit)
  // 2. Toward the top of the ramp the highlight tint takes over, so the light
  //    reads as a material highlight rather than as a brighter blue. A squared
  //    window keeps the lift in the top third, where a real highlight lives,
  //    and OKLab keeps that lift a lighter blue instead of a grey-blue, which
  //    is what lets the window run at full strength: the top of the ramp has
  //    to clear the base colour after the cavity pass, or the body reads as
  //    painted flat from the lit side.
  const highlight = lit * lit * (3 - 2 * lit) * lit
  color = mixOklab(
    color,
    material.palette.highlight,
    clamp01(highlight) * (1 - material.roughness * 0.35)
  )
  // 3. Cavity darkens; it never reaches black. The occlusion is weighted
  //    against the light: a crevice turned toward the key is not in shadow.
  //    The ramp's brightest sample lands close to the limb, where the edge
  //    term runs at half strength — measured, a flat 0.55 mix pulled the peak
  //    of the ramp back to the base colour (L132 against a palette highlight
  //    of L203), and that missing cap *is* the tonal range the reference
  //    artwork has and the render did not.
  color = mixOklab(
    color,
    material.palette.cavity,
    clamp01(shading.cavity) * 0.55 * (1 - lit * 0.65)
  )
  // 4. Macro drift: barely perceptible tonal unevenness.
  color = shiftColor(color, {
    lightness: variation.macro * material.macroNoise * 0.06,
    chroma: 1 + variation.macro * material.colorVariation,
  })
  // 5. Micro break of digital perfection, at the smallest amplitude that
  //    still registers when the dot is enlarged.
  color = shiftColor(color, {
    lightness: variation.micro * material.microNoise * 0.018,
    chroma: 1 + variation.micro * material.colorVariation * 0.5,
  })

  return color
}

export const buildBlobLighting = (
  lighting: BlobLightingConfig,
  material: BlobMaterialDefinition,
  field: SurfaceField,
  quality: RenderQuality,
  seed: number,
  deformation: number
): BlobLightingDefinition => {
  const { center, radiusX, radiusY } = field
  const radius = Math.max(radiusX, radiusY)

  const rig = createLightRig({
    keyX: lighting.lightX,
    keyY: lighting.lightY,
    keyZ: lighting.lightZ,
    keyColor: material.palette.highlight,
    fillColor: material.palette.rim,
    rimColor: material.palette.sheen,
    intensity: lighting.intensity,
    fillIntensity: lighting.fillIntensity,
    rimIntensity: lighting.rimStrength,
    ambient: lighting.ambient,
    softness: lighting.softness,
  })

  const azimuth = Math.atan2(rig.key.position.y, rig.key.position.x)
  const axisX = Math.cos(azimuth)
  const axisY = Math.sin(azimuth)

  const probes = probesFor(quality)
  let minDiffuse = Number.POSITIVE_INFINITY
  let maxDiffuse = Number.NEGATIVE_INFINITY
  let cavityTotal = 0
  let specularTotal = 0
  let rimTotal = 0
  let probeCount = 0

  // The volume ramp is sampled radially toward the key light. Each stop is the
  // colour of the surface at that distance, so the ramp encodes the actual
  // shading field rather than a decorative gradient.
  const focusShift = focusShiftFor(material.lightSpread)
  const volumeRadius = radius * (1 + focusShift)
  // The focus still decides where the highlight sits and how broad it is, so
  // a tight material and a broad one are visibly different.
  const volumeCx = center.x + axisX * radius * focusShift
  const volumeCy = center.y + axisY * radius * focusShift

  // The probe sweep crosses the body along the light axis, from the shadowed
  // limb to the lit one, so every sample is a real surface point and the ramp
  // rises with the light. Marching outward from the centre instead would leave
  // half the sweep outside the silhouette, where the normal clamps and every
  // sample comes back the same colour.
  const axisPoints = Array.from({ length: probes }, (_, index) => {
    const distance = (index / (probes - 1)) * 2 - 1
    return { x: center.x + axisX * distance * radius, y: center.y + axisY * distance * radius }
  })
  const deepPoint = { x: center.x - axisX * radius * 0.9, y: center.y - axisY * radius * 0.9 }
  const midPoint = { x: center.x, y: center.y }
  const litPoint = { x: center.x + axisX * radius * 0.55, y: center.y + axisY * radius * 0.55 }

  // Every colour of the ramp is normalized against the strongest diffuse
  // contribution the sampled surface actually receives: the true maximum of
  // the rig over these points, not the facing pole, which sits at barely half
  // of it because the key light is off to the side. A peak below the real
  // maximum saturates `lit` at 1 for the whole bright half of the ramp, and a
  // saturated ramp is shaped by the cavity and the noise instead of by the
  // light — measured, that is the difference between a modelled volume and a
  // flat tint.
  const axisShadings = axisPoints.map(point =>
    shadeAt(field, material, rig, point, seed, deformation)
  )
  const deepShading = shadeAt(field, material, rig, deepPoint, seed, deformation)
  const midShading = shadeAt(field, material, rig, midPoint, seed, deformation)
  const litShading = shadeAt(field, material, rig, litPoint, seed, deformation)
  let peak = 1e-4
  for (const shading of [...axisShadings, deepShading, midShading, litShading]) {
    peak = Math.max(peak, shading.diffuseField - shading.ambient)
  }

  const stops: GradientStop[] = []
  for (let index = 0; index < probes; index++) {
    const t = index / (probes - 1)
    const shading = axisShadings[index]
    minDiffuse = Math.min(minDiffuse, shading.diffuseField)
    maxDiffuse = Math.max(maxDiffuse, shading.diffuseField)
    cavityTotal += shading.cavity
    specularTotal += shading.specular
    rimTotal += shading.rim
    probeCount += 1
    const color = evaluateColor(
      material,
      shading,
      sampleSurfaceVariation(axisPoints[index], field, seed),
      peak
    )
    stops.push({ offset: t, color, opacity: 1 })
  }

  // A wider sweep across the body supplies the vertical falloff the axis ramp
  // cannot express, because the axis and the screen's up direction differ.
  const washStart = {
    x: center.x + axisX * radius * 1.25,
    y: center.y + axisY * radius * 1.25,
  }
  const washEnd = {
    x: center.x - axisX * radius * 1.25,
    y: center.y - axisY * radius * 1.25,
  }

  const deepColor = evaluateColor(
    material,
    deepShading,
    sampleSurfaceVariation(deepPoint, field, seed),
    peak
  )
  const midColor = evaluateColor(
    material,
    midShading,
    sampleSurfaceVariation(midPoint, field, seed),
    peak
  )
  const litColor = evaluateColor(
    material,
    litShading,
    sampleSurfaceVariation(litPoint, field, seed),
    peak
  )

  minDiffuse = Math.min(
    minDiffuse,
    deepShading.diffuseField,
    midShading.diffuseField,
    litShading.diffuseField
  )
  maxDiffuse = Math.max(
    maxDiffuse,
    deepShading.diffuseField,
    midShading.diffuseField,
    litShading.diffuseField
  )
  cavityTotal += deepShading.cavity + midShading.cavity + litShading.cavity
  specularTotal += deepShading.specular + midShading.specular + litShading.specular
  rimTotal += deepShading.rim + midShading.rim + litShading.rim
  probeCount += 3

  const coreShadow: RadialLayer = {
    cx: center.x - axisX * radius * 0.78,
    cy: center.y - axisY * radius * 0.78,
    radius: radius * 1.05,
    fx: center.x - axisX * radius * 0.78,
    fy: center.y - axisY * radius * 0.78,
    stops: [
      {
        offset: 0,
        color: deepColor,
        opacity: clamp01(lighting.shadowStrength * 0.7 * clamp01(deepShading.diffuseField + 0.3)),
      },
      { offset: 0.62, color: deepColor, opacity: lighting.shadowStrength * 0.3 },
      { offset: 1, color: deepColor, opacity: 0 },
    ],
  }

  const fillAngle = azimuth + (150 * Math.PI) / 180
  const fillCx = center.x + Math.cos(fillAngle) * radius * 0.95
  const fillCy = center.y + Math.sin(fillAngle) * radius * 0.95 - radius * 0.22
  const fill: RadialLayer = {
    cx: fillCx,
    cy: fillCy,
    radius: radius * 1.5,
    fx: fillCx,
    fy: fillCy,
    stops: [
      {
        offset: 0,
        color: material.palette.rim,
        opacity: clamp01(lighting.fillIntensity * 0.14 * (1 - lighting.ambient * 0.5)),
      },
      { offset: 1, color: material.palette.rim, opacity: 0 },
    ],
  }

  // The wash and fill layers are additive lifts over the body ramp. They exist
  // to keep the surface from reading as a pure axis sweep, and they are the
  // easiest way to wash the contrast back out, so their opacities are kept
  // deliberately low: the ramp carries the volume, these only soften it.
  const washLight: LinearLayer = {
    x1: washStart.x,
    y1: washStart.y,
    x2: washEnd.x,
    y2: washEnd.y,
    stops: [
      { offset: 0, color: litColor, opacity: clamp01(lighting.intensity * 0.05) },
      { offset: 0.5, color: midColor, opacity: clamp01(lighting.intensity * 0.02) },
      { offset: 1, color: midColor, opacity: 0 },
    ],
  }
  const washShadow: LinearLayer = {
    x1: washStart.x,
    y1: washStart.y,
    x2: washEnd.x,
    y2: washEnd.y,
    stops: [
      { offset: 0, color: deepColor, opacity: 0 },
      // The mid stop sits where the ramp's bright band is: measured, at 0.16
      // it pulled the body's 95th percentile down 15 points for a floor the
      // edge stop already covers. The floor stays dark; the top is freed.
      { offset: 0.34, color: deepColor, opacity: clamp01(lighting.shadowStrength * 0.09) },
      { offset: 1, color: deepColor, opacity: clamp01(lighting.shadowStrength * 0.62) },
    ],
  }

  // The highlight sits where the half vector of the real rig points, not at a
  // hand-tuned offset, so moving the key light moves the highlight with it.
  // It is pushed well off the centre: a highlight on the axis of a sphere
  // reads as a decal rather than as a reflection, because a real specular
  // peak sits between the pole and the lit limb.
  const specDistance = radius * lerp(0.62, 0.4, clamp01(1 - material.lightSpread))
  const specularRadius = radius * lerp(0.5, 0.3, clamp01(1 - material.lightSpread))

  return {
    light: { x: rig.key.position.x, y: rig.key.position.y, z: rig.key.position.z },
    azimuth,
    axisX,
    axisY,
    rig,
    volume: {
      x1: center.x - axisX * radius * 1.15,
      y1: center.y - axisY * radius * 1.15,
      x2: center.x + axisX * radius * 1.15,
      y2: center.y + axisY * radius * 1.15,
      stops,
    },
    coreShadow,
    fill,
    washLight,
    washShadow,
    rim: {
      color: material.palette.rim,
      width: radius * (0.08 + 0.2 * lighting.rimWidth),
      // Measured: the rim painted the shadow-side edge too, lifting the body's
      // 5th percentile by 5 luminance points — a floor the core shadow had
      // just darkened. A narrower trim keeps the lit-side edge highlight and
      // gives back the bottom of the tonal range.
      opacity: clamp01(lighting.rimStrength * material.rimBoost * 0.28),
      insetFactor: 0.9,
      maskAngle: azimuth,
    },
    cavity: {
      color: material.palette.cavity,
      width: radius * 0.26,
      // Measured: a heavier cavity stroke is what ate the top 5% of the body
      // (p95 fell 16 points with the full stack on), so it is kept to a
      // deepening at the very edge rather than a ring over the bright zone.
      opacity: clamp01(lighting.cavityStrength * 0.34),
      insetFactor: 0.87,
      blur: radius * 0.11,
    },
    edgeShade: {
      color: material.palette.shadow,
      width: radius * 0.14,
      opacity: clamp01(lighting.shadowStrength * 0.11),
      insetFactor: 0.94,
    },
    specular: {
      cx: center.x + rig.halfVector.x * specDistance,
      cy: center.y + rig.halfVector.y * specDistance,
      rx: specularRadius,
      ry: specularRadius * 0.66,
      rotation: (azimuth * 180) / Math.PI,
      // A white-shifted sheen clips to a plastic bead; keeping the shift
      // small lets the highlight stay a lit version of the material.
      color: mixColors(material.palette.sheen, '#ffffff', 0.18),
      // The specular is the top 5% of the pixels: it is what buys tonal
      // range without bleaching the body, so it runs well above "plausible"
      // opacity. Measured: without it the bright end tops out at the ramp.
      opacity: clamp01(material.specularStrength * lighting.intensity * 2),
    },
    sheen: {
      color: material.palette.sheen,
      opacity: clamp01(material.sheen * 0.5),
      angle: azimuth,
    },
    colorFields: buildColorFields({
      material,
      azimuth,
      centerX: center.x,
      centerY: center.y,
      radius,
      axisX,
      axisY,
      count: material.colorSpots,
      intensity: lighting.intensity,
    }),
    stats: {
      samples: probeCount,
      minDiffuse: Number.isFinite(minDiffuse) ? minDiffuse : lighting.ambient,
      maxDiffuse: Number.isFinite(maxDiffuse) ? maxDiffuse : lighting.ambient + 1,
      meanCavity: probeCount ? cavityTotal / probeCount : 0,
      meanSpecular: probeCount ? specularTotal / probeCount : 0,
      meanRim: probeCount ? rimTotal / probeCount : 0,
    },
  }
}

/**
 * Convenience seam: the field without the lighting.
 *
 * The debug overlay and the acceptance grid need the geometry alone, and
 * exposing it here keeps the geometry-to-material boundary in one file.
 */
export const surfaceFieldFromPose = (pose: AvatarPose, surface: SurfaceConfig): SurfaceField =>
  buildSurfaceField(pose, surface)
