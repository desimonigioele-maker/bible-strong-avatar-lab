/**
 * Per-pixel lighting path (FASI 20, 21, 22).
 *
 * The gradient path samples the shading field at a bounded number of points
 * and interpolates between them. That is enough for a soft body, but the
 * prompt's requirement is stricter: material resolution must be independent of
 * geometry resolution, and a silhouette with sixty points must be able to carry
 * a surface with thousands.
 *
 * SVG already has a per-pixel lighting engine — `feDiffuseLighting` and
 * `feSpecularLighting` compute `max(0, N·L)` from the *gradient of a height
 * field* at every pixel. The catch is that those primitives are
 * **objectBoundingBox** relative: they light the filter's own box, not a shape
 * placed inside it. So the filter is applied to an exact-size rect whose
 * bounds are the field's, with a `feImage` mask doing the silhouette clip.
 *
 * The height field itself is a radial gradient of `z = sqrt(1 - r²)` in
 * *elliptical* user space, which is the exact height function of an ellipsoid:
 * for a sphere this reproduces the analytic model exactly, and for an
 * elongated dot it is correct rather than approximately circular. A
 * `feTurbulence` + `feDisplacementMap` pair deforms it, which is the same
 * deformed-normal idea as the gradient path, resolved per pixel.
 *
 * The gradient path remains the default. This is an alternative, opt-in
 * renderer for HIGH and ULTRA.
 */

import { mixColors } from './blobColor'
import type { BlobLightingDefinition, GradientStop } from './blobLighting'
import type { SurfaceField } from './blobSurfaceField'
import { format } from './blobUtils'
import type { BlobMaterialDefinition } from './blobMaterial'

export type PerPixelLayer = {
  /** The rect that carries the height field and therefore the filter. */
  shape: string
  defs: string
  /** Base colour of the lit body, exposed so callers can reuse it. */
  bodyColor: string
}

/**
 * Height stops of an ellipsoid, sampled along the normalized radius.
 *
 * The height is written into the **alpha** channel, not the colour: the SVG
 * lighting primitives read `SourceAlpha` as the bump map. A grey ramp with full
 * opacity — which looks like a height field — produces a perfectly flat surface
 * and a uniformly lit blob.
 */
const ellipsoidHeightStops = (samples: number): GradientStop[] => {
  const stops: GradientStop[] = []
  for (let index = 0; index < samples; index++) {
    const t = index / (samples - 1)
    // z = sqrt(1 - r²): the exact height of a unit hemisphere at normalized
    // radius r. The color is irrelevant to the primitives; the alpha is the
    // height.
    const height = Math.sqrt(Math.max(0, 1 - t * t))
    stops.push({ offset: t, color: '#000000', opacity: clampUnit(height) })
  }
  return stops
}

const clampUnit = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * Builds the per-pixel material.
 *
 * The lights are given in camera space and the filter's `primitiveUnits` are
 * set to `userSpaceOnUse`, so a `feDistantLight` azimuth is an angle in the
 * scene's own frame: the lighting stays anchored to the camera while the body
 * rotates inside it, exactly as the gradient path does (FASI 63).
 */
export const buildPerPixelLayer = (input: {
  idPrefix: string
  field: SurfaceField
  lighting: BlobLightingDefinition
  material: BlobMaterialDefinition
  /**
   * The silhouette, as a path.
   *
   * The height gradient is an opaque rect, so the filter output has to be
   * clipped explicitly. Relying on the gradient's alpha instead lights the
   * whole bounding box and the result is a rounded rectangle, not a dot.
   */
  silhouettePath: string
  /** Height samples: the material resolution, independent of the silhouette. */
  samples: number
  /** Seed for the displacement noise, forwarded so the deform is deterministic. */
  seed: number
  /** Amplitude of the surface deformation, 0 disables the filter pair. */
  deformation: number
}): PerPixelLayer => {
  const { field, lighting, material } = input
  const prefix = input.idPrefix
  const { center, radiusX, radiusY } = field

  // The filter's box is the field's own bounds, so objectBoundingBox units
  // cover exactly the dot and nothing else.
  const boxX = center.x - radiusX * 1.02
  const boxY = center.y - radiusY * 1.02
  const boxWidth = radiusX * 2.04
  const boxHeight = radiusY * 2.04

  const heightStops = ellipsoidHeightStops(input.samples)

  // The silhouette clip. Applied outside the filter, because a filter's region
  // is its own box and the primitive chain inside cannot see the path.
  const silhouetteClip = `<clipPath id="${prefix}-pp-clip"><path d="${input.silhouettePath}"/></clipPath>`

  // A radial gradient in elliptical user space: the x and y radii differ, so a
  // pill gets a pill-shaped height field instead of a squashed sphere's.
  const heightGradient =
    `<radialGradient id="${prefix}-height" gradientUnits="userSpaceOnUse"` +
    ` cx="${format(center.x)}" cy="${format(center.y)}"` +
    ` r="${format(radiusX)}"` +
    ` fx="${format(center.x)}" fy="${format(center.y)}"` +
    ` gradientTransform="matrix(${format(radiusY / Math.max(1e-6, radiusX))} 0 0 1 0 0)">` +
    heightStops
      .map(
        stop =>
          `<stop offset="${format(stop.offset)}" stop-color="${stop.color}"` +
          ` stop-opacity="${format(stop.opacity)}"/>`
      )
      .join('') +
    '</radialGradient>'

  const key = lighting.rig.key
  const fill = lighting.rig.fill
  const rim = lighting.rig.rim

  // Azimuth in degrees, measured in the scene frame. `feDistantLight` takes an
  // angle, which is exactly the parameterization a camera-anchored rig wants.
  const azimuthOf = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI
  const elevationOf = (z: number) => {
    const horizontal = Math.hypot(key.position.x, key.position.y) || 1e-6
    return (Math.atan2(z, horizontal) * 180) / Math.PI
  }

  // The deformation: a low-frequency turbulence displacing the height field.
  // Small `scale` and low `baseFrequency` produce an imperfect surface rather
  // than a rippled one, which is the point (FASI 7).
  const deform =
    input.deformation > 0
      ? `<feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2"` +
        ` seed="${input.seed % 9973}" result="deformNoise"/>` +
        `<feDisplacementMap in="SourceGraphic" in2="deformNoise" scale="${format(
          radiusX * 0.06 * input.deformation * 20
        )}" xChannelSelector="R" yChannelSelector="G" result="deformed"/>`
      : ''

  const defs =
    heightGradient +
    silhouetteClip +
    `<filter id="${prefix}-pp" x="0%" y="0%" width="100%" height="100%"` +
    ` color-interpolation-filters="sRGB">` +
    deform +
    // Fine surface grain, resolved by the lighting itself. A small
    // high-frequency height perturbation makes N·L vary pixel by pixel, so the
    // texture belongs to the material instead of being painted on top of it —
    // a painted band costs saturation (measured), this costs none, and it is
    // exactly what the per-pixel path exists for: surface detail at material
    // resolution. Without it a perfectly smooth height field is a perfectly
    // smooth render however many pixels it has: the per-pixel body measured
    // 2.8 texture against the gradient path's 3.6 on the same materials.
    `<feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2"` +
    ` seed="${(input.seed % 9919) + 17}" result="microBumpNoise"/>` +
    `<feComposite in="microBumpNoise" in2="${
      input.deformation > 0 ? 'deformed' : 'SourceGraphic'
    }" operator="arithmetic" k1="0" k2="0.07" k3="1" k4="0" result="bumped"/>` +
    // Key light: real per-pixel Lambert from the height gradient.
    `<feDiffuseLighting in="bumped"` +
    ` surfaceScale="${format(radiusX * 0.85)}" diffuseConstant="${format(key.intensity)}"` +
    ` lighting-color="${material.palette.highlight}" result="keyLight">` +
    `<feDistantLight azimuth="${format(azimuthOf(key.position.x, key.position.y))}"` +
    ` elevation="${format(elevationOf(key.position.z))}"/>` +
    '</feDiffuseLighting>' +
    // Fill light: opposite, cooler and weaker, so the shadow side stays alive.
    `<feDiffuseLighting in="bumped"` +
    ` surfaceScale="${format(radiusX * 0.85)}" diffuseConstant="${format(fill.intensity)}"` +
    ` lighting-color="${material.palette.rim}" result="fillLight">` +
    `<feDistantLight azimuth="${format(azimuthOf(fill.position.x, fill.position.y))}"` +
    ` elevation="${format(elevationOf(fill.position.z))}"/>` +
    '</feDiffuseLighting>' +
    // Rim: a light behind the surface, so it only reaches grazing angles.
    `<feDiffuseLighting in="bumped"` +
    ` surfaceScale="${format(radiusX * 0.6)}" diffuseConstant="${format(rim.intensity * 0.8)}"` +
    ` lighting-color="${material.palette.sheen}" result="rimLight">` +
    `<feDistantLight azimuth="${format(azimuthOf(rim.position.x, rim.position.y))}"` +
    ` elevation="-25"/>` +
    '</feDiffuseLighting>' +
    // Specular: Blinn-Phong with a broad lobe, which is what a soft material
    // needs. A tight exponent here is what makes a body look like a bead.
    `<feSpecularLighting in="bumped"` +
    ` surfaceScale="${format(radiusX * 0.9)}"` +
    // The specular is the renderer's top percentile: a near-invisible lobe
    // leaves the tonal range to the ramp alone, which measurably caps it.
    ` specularConstant="${format(material.specularStrength * 3)}"` +
    ` specularExponent="${format(Math.max(3, 42 - material.specularPower * 1.6))}"` +
    ` lighting-color="#ffffff" result="specLight">` +
    `<feDistantLight azimuth="${format(azimuthOf(key.position.x, key.position.y))}"` +
    ` elevation="${format(elevationOf(key.position.z))}"/>` +
    '</feSpecularLighting>' +
    // Ambient floor, as a flat flood the diffuse terms are screened over.
    // Held below the rig's nominal ambient (measured at 0.55 of it): a flat
    // floor lifts the *shadows* everywhere, and deep saturated palettes pay
    // for that in tonal range — measured, the per-pixel path lost 2-25 range
    // points against the gradient path on exactly the deepened materials.
    // The gradient path made the same trim in Fase E (washShadow 0.16→0.09).
    `<feFlood flood-color="${material.palette.base}" flood-opacity="${format(
      clampUnit(lighting.rig.ambient * 0.55)
    )}" result="ambient"/>` +
    '<feComposite in="ambient" in2="SourceGraphic" operator="in" result="ambientClipped"/>' +
    // Screen the three lights together, then add the specular.
    '<feComposite in="keyLight" in2="fillLight" operator="arithmetic" k1="0" k2="1" k3="0.6" k4="0" result="lightsSum"/>' +
    '<feComposite in="lightsSum" in2="rimLight" operator="arithmetic" k1="0" k2="1" k3="0.35" k4="0" result="rimSum"/>' +
    '<feBlend in="rimSum" in2="ambientClipped" mode="screen" result="litBody"/>' +
    // Tint: the lights are luminance, so the base colour multiplies over them,
    // which keeps the hue in the lit region.
    `<feFlood flood-color="${mixColors(material.palette.base, material.palette.midtone, 0.4)}" result="baseTint"/>` +
    '<feBlend in="litBody" in2="baseTint" mode="multiply" result="tintedBody"/>' +
    // The specular is the one term that must survive the tint. Added before
    // it, the multiply capped every pixel of the body at the base colour —
    // measured, the per-pixel renderer's 95th percentile could not clear the
    // base's luminance however bright the lobe, and that ceiling was the
    // whole tonal-range gap against the gradient path. Screened after the
    // tint, the highlight keeps its own white and the hue stays in the mids.
    '<feBlend in="specLight" in2="tintedBody" mode="screen" result="tinted"/>' +
    // The key light, added back after the tint at a quarter strength. The
    // multiply keeps the hue but pins the whole body under the base colour's
    // luminance; this lift is zero wherever the key does not reach (the
    // floor is untouched) and raises the lit band toward the gradient path's
    // bright zone. `keyLight` is the pale highlight colour, not white, so the
    // lift costs less saturation than a white screen for the same range.
    '<feComposite in="tinted" in2="keyLight" operator="arithmetic" k1="0" k2="1" k3="0.25" k4="0" result="keyLift"/>' +
    // The tint is composited back over the source's alpha rather than kept
    // alone, so the body is as solid as the silhouette even though the height
    // field necessarily reaches zero at the limb.
    '<feComposite in="keyLift" in2="SourceGraphic" operator="in" result="clipped"/>' +
    // A gentle blur removes the one-pixel staircase the height gradient
    // leaves at the limb without softening the modelled shading — kept below
    // the old 1.2 radius, which was also erasing the micro-bump's grain, but
    // high enough that the grain reads as material instead of crumple.
    `<feGaussianBlur in="clipped" stdDeviation="${format(Math.min(0.9, radiusX * 0.009))}"/>` +
    '</filter>'

  // The rect is the filter's subject, and the filter's *input* is the height
  // field. The clip is what turns the filter's box back into a dot; the alpha
  // the height gradient necessarily loses at the limb is restored by drawing
  // the silhouette underneath at the base colour, so the edge stays solid
  // instead of fading out.
  const shape =
    `<g clip-path="url(#${prefix}-pp-clip)">` +
    `<path d="${input.silhouettePath}" fill="${material.palette.base}"/>` +
    `<rect x="${format(boxX)}" y="${format(boxY)}" width="${format(boxWidth)}"` +
    ` height="${format(boxHeight)}" fill="url(#${prefix}-height)"` +
    ` filter="url(#${prefix}-pp)"/>` +
    `</g>`

  return { shape, defs, bodyColor: material.palette.base }
}
