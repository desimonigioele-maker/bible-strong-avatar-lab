/**
 * SVG serializer for the blob engine (FASI 12, 22, 26, 55, 68).
 *
 * This is the single source of truth for what a blob looks like: the studio
 * preview, the SVG export and any future batch renderer all call it, so the
 * exported asset cannot drift from the preview. It emits self-contained markup
 * - gradients, masks and blend modes are inlined, nothing depends on the app
 * stylesheet.
 *
 * Every id is namespaced by `options.idPrefix`, so several blobs can share a
 * page without their gradient, mask, clip or filter ids colliding.
 */

import {
  createTextureShader,
  poseFromExpression,
  type AvatarPose,
  type AvatarTextureConfig,
  type Expression,
  type SurfaceConfig,
} from '@bible-strong/avatar-core'

import { shiftColor } from './blobColor'
import { normalizeBlobConfig } from './blobConfig'
import { buildBlobDebugOverlay, type BlobDebugFlag } from './blobDebug'
import { buildBlobGeometry, buildBlobInsetPath, type BlobGeometry } from './blobGeometry'
import { buildBlobLighting, type BlobLightingDefinition, type RadialLayer } from './blobLighting'
import { createBlobMaterial, type BlobMaterialDefinition } from './blobMaterial'
import { buildPerPixelLayer } from './blobPerPixel'
import { buildSurfaceField, type SurfaceField } from './blobSurfaceField'
import {
  buildSurfaceNoiseLayers,
  resolveSurfacePlan,
  type BlobSurfacePlan,
  type SurfaceNoiseLayer,
} from './blobSurface'
import { clamp01, format, smilePath } from './blobUtils'
import type { BlobConfig, BlobMotionConfig, RenderQuality } from './blobTypes'

/** Authoring frame shared with the rest of the avatar lab. */
const FRAME = 320

export type BlobSvgOptions = {
  /** Namespaces every gradient, mask, clip and filter id. */
  idPrefix?: string
  quality?: RenderQuality
  viewBox?: string
  width?: number | string
  height?: number | string
  /** Skip the face so the blob can be used as a decorative graphic. */
  withExpression?: boolean
  /** Accessible label; omit for a purely decorative blob. */
  label?: string
  background?: string
  /** Soft contact shadow under the body. */
  groundShadow?: boolean
  /**
   * Camera pose the material is attached to.
   *
   * Supplying the live pose is what makes the dot inherit the avatar's
   * perspective, head rotation and depth, so the material and the eyes are
   * describing the same object (FASI 24).
   */
  pose?: AvatarPose
  /**
   * Debug overlays to draw on top of the body (FASI 43).
   *
   * Empty by default. Each flag exposes one term of the shading pipeline, so a
   * regression can be read off the render instead of guessed at.
   */
  debug?: BlobDebugFlag[]
  /**
   * Precomputed surface field.
   *
   * The field depends only on the shape, the surface config and the pose, so a
   * page that shows many materials on one silhouette can build it once. It is
   * an optimization only: leaving it out produces an identical render, just
   * slower.
   */
  field?: SurfaceField
  /** Deterministic motion sample in seconds; 0 renders the rest pose. */
  motionTime?: number
  /**
   * Optional studio texture (felt / plush / glossy / neon).
   *
   * The texture is an *additional* layer over the modelled volume, not a
   * replacement for it: the gradient ramp still carries the form, and the
   * texture adds the finish on top. Clipped to the blob outline.
   */
  texture?: AvatarTextureConfig
}

export type BlobScene = {
  config: BlobConfig
  geometry: BlobGeometry
  /** The projected surface the material is lit against. */
  field: SurfaceField
  material: BlobMaterialDefinition
  lighting: BlobLightingDefinition
  plan: BlobSurfacePlan
  noise: SurfaceNoiseLayer[]
  defs: string
  body: string
  face: string
  shadow: string
  /** Blurred body copy painted behind the blob; set by glow textures. */
  glow: string
  /** Texture layers that belong above the surface but below the highlights. */
  textureUnderSurface: string
  /** Texture layers that belong above everything. */
  textureTop: string
  /** Inert diagnostic markup; empty unless `options.debug` asked for it. */
  debug: string
}

export type BlobMotionSample = {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
  rotation: number
}

export const sampleBlobMotion = (motion: BlobMotionConfig, time: number): BlobMotionSample => {
  const rest: BlobMotionSample = {
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
    rotation: 0,
  }
  if (!motion.enabled) return rest

  // Four independent oscillators (distinct default frequencies + phases): breathing,
  // float, surface drift, rotation. Drift deliberately no longer shares float's
  // oscillator — the old sync made one joint motion instead of layered movement.
  const breath = Math.sin(time * motion.breathingSpeed * Math.PI * 2)
  const drift = Math.sin(time * motion.floatSpeed * Math.PI * 2 + 1.1)
  const slide = Math.sin(time * motion.surfaceDriftSpeed * Math.PI * 2 + 2.6)
  const spin = Math.sin(time * motion.rotationSpeed * Math.PI * 2 + 0.4)

  return {
    // Breathing scales one axis up and the other down, which reads as a body
    // rather than as a pulsing circle.
    scaleX: 1 - breath * motion.breathing * 0.5,
    scaleY: 1 + breath * motion.breathing,
    translateX: slide * motion.surfaceDrift * 1.5,
    translateY: drift * motion.float * 30,
    rotation: spin * motion.rotation,
  }
}

const radialGradient = (id: string, layer: RadialLayer): string => {
  const stops = layer.stops
    .map(
      stop =>
        `<stop offset="${format(stop.offset)}" stop-color="${stop.color}" stop-opacity="${format(
          clamp01(stop.opacity)
        )}"/>`
    )
    .join('')
  return (
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse"` +
    ` cx="${format(layer.cx)}" cy="${format(layer.cy)}" r="${format(layer.radius)}"` +
    ` fx="${format(layer.fx)}" fy="${format(layer.fy)}">${stops}</radialGradient>`
  )
}

const linearGradient = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stops: { offset: number; color: string; opacity: number }[]
): string =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"` +
  ` x1="${format(x1)}" y1="${format(y1)}" x2="${format(x2)}" y2="${format(y2)}">` +
  stops
    .map(
      stop =>
        `<stop offset="${format(stop.offset)}" stop-color="${stop.color}" stop-opacity="${format(
          clamp01(stop.opacity)
        )}"/>`
    )
    .join('') +
  '</linearGradient>'

const gaussianBlur = (id: string, deviation: number): string =>
  `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
  `<feGaussianBlur stdDeviation="${format(deviation)}"/></filter>`

const noiseFilter = (layer: SurfaceNoiseLayer): string =>
  `<filter id="${layer.filterId}" x="0%" y="0%" width="100%" height="100%">` +
  `<feTurbulence type="${layer.turbulenceType}" baseFrequency="${layer.baseFrequency}"` +
  ` numOctaves="${layer.numOctaves}" seed="${layer.seed}"/>` +
  `<feColorMatrix type="matrix" values="0 0 0 0 ${format(layer.tone)} 0 0 0 0 ${format(
    layer.tone
  )} 0 0 0 0 ${format(layer.tone)} 0 0 0 1.2 0"/>` +
  '</filter>'

const fullFrameRect = (fill: string, extra = ''): string =>
  `<rect x="${-FRAME / 2}" y="${-FRAME / 2}" width="${FRAME}" height="${FRAME}" fill="${fill}" ${extra}/>`

const blended = (mode: string, opacity: number, content: string): string =>
  opacity <= 0.001
    ? ''
    : `<g style="mix-blend-mode:${mode}" opacity="${format(clamp01(opacity))}">${content}</g>`

const clipped = (clipId: string, content: string): string =>
  content ? `<g clip-path="url(#${clipId})" pointer-events="none">${content}</g>` : ''

/** A blurred, wide stroke following an outline: the cavity and rim workhorse. */
const outlineStroke = (
  path: string,
  color: string,
  width: number,
  filterId: string,
  maskId?: string
): string =>
  `<path d="${path}" fill="none" stroke="${color}" stroke-width="${format(width)}"` +
  (filterId ? ` filter="url(#${filterId})"` : '') +
  (maskId ? ` mask="url(#${maskId})"` : '') +
  '/>'

const buildDefs = (
  prefix: string,
  geometry: BlobGeometry,
  lighting: BlobLightingDefinition,
  noise: SurfaceNoiseLayer[],
  extraDefs = ''
): string => {
  const { center, radius } = geometry
  const axisX = Math.cos(lighting.azimuth)
  const axisY = Math.sin(lighting.azimuth)

  // Black on the lit side, white on the shadowed side: the rim only ever
  // appears opposite the key light (FASE 54).
  const rimSideGradient = linearGradient(
    `${prefix}-rim-side`,
    center.x + axisX * radius * 1.2,
    center.y + axisY * radius * 1.2,
    center.x - axisX * radius * 1.2,
    center.y - axisY * radius * 1.2,
    [
      { offset: 0, color: '#000000', opacity: 1 },
      { offset: 0.45, color: '#000000', opacity: 1 },
      { offset: 1, color: '#ffffff', opacity: 1 },
    ]
  )

  const rimMask =
    `<mask id="${prefix}-rim-mask" maskUnits="userSpaceOnUse"` +
    ` x="${-FRAME}" y="${-FRAME}" width="${FRAME * 2}" height="${FRAME * 2}">` +
    fullFrameRect(`url(#${prefix}-rim-side)`) +
    '</mask>'

  const sheenAxis = {
    x: Math.cos(lighting.sheen.angle),
    y: Math.sin(lighting.sheen.angle),
  }

  return [
    // A clipPath needs a filled shape, never a stroke.
    `<clipPath id="${prefix}-clip"><path d="${geometry.path}"/></clipPath>`,
    // The volume ramp is linear along the light axis, because that is the
    // direction in which a lit sphere actually changes.
    linearGradient(
      `${prefix}-volume`,
      lighting.volume.x1,
      lighting.volume.y1,
      lighting.volume.x2,
      lighting.volume.y2,
      lighting.volume.stops
    ),
    radialGradient(`${prefix}-core`, lighting.coreShadow),
    radialGradient(`${prefix}-fill`, lighting.fill),
    linearGradient(
      `${prefix}-wash-light`,
      lighting.washLight.x1,
      lighting.washLight.y1,
      lighting.washLight.x2,
      lighting.washLight.y2,
      lighting.washLight.stops
    ),
    linearGradient(
      `${prefix}-wash-shadow`,
      lighting.washShadow.x1,
      lighting.washShadow.y1,
      lighting.washShadow.x2,
      lighting.washShadow.y2,
      lighting.washShadow.stops
    ),
    ...lighting.colorFields.map((spot, index) =>
      radialGradient(`${prefix}-spot-${index}`, {
        cx: spot.cx,
        cy: spot.cy,
        radius: spot.radius,
        fx: spot.cx,
        fy: spot.cy,
        stops: [
          { offset: 0, color: spot.color, opacity: 1 },
          { offset: 0.55, color: spot.color, opacity: 0.42 },
          { offset: 1, color: spot.color, opacity: 0 },
        ],
      })
    ),
    radialGradient(`${prefix}-specular`, {
      cx: lighting.specular.cx,
      cy: lighting.specular.cy,
      radius: lighting.specular.rx,
      fx: lighting.specular.cx,
      fy: lighting.specular.cy,
      stops: [
        { offset: 0, color: lighting.specular.color, opacity: 1 },
        { offset: 0.55, color: lighting.specular.color, opacity: 0.45 },
        { offset: 1, color: lighting.specular.color, opacity: 0 },
      ],
    }),
    radialGradient(`${prefix}-shadow`, {
      cx: center.x,
      cy: center.y + radius * 1.18,
      radius: radius * 0.95,
      fx: center.x,
      fy: center.y + radius * 1.18,
      stops: [
        { offset: 0, color: '#000000', opacity: 0.26 },
        { offset: 0.6, color: '#000000', opacity: 0.12 },
        { offset: 1, color: '#000000', opacity: 0 },
      ],
    }),
    linearGradient(
      `${prefix}-sheen`,
      center.x - sheenAxis.x * radius,
      center.y - sheenAxis.y * radius,
      center.x + sheenAxis.x * radius,
      center.y + sheenAxis.y * radius,
      [
        { offset: 0, color: lighting.sheen.color, opacity: 0 },
        { offset: 0.45, color: lighting.sheen.color, opacity: 1 },
        { offset: 1, color: lighting.sheen.color, opacity: 0 },
      ]
    ),
    rimSideGradient,
    rimMask,
    gaussianBlur(`${prefix}-rim-blur`, radius * 0.09),
    gaussianBlur(`${prefix}-cavity-blur`, lighting.cavity.blur),
    ...noise.map(noiseFilter),
    extraDefs,
  ].join('')
}

const buildBody = (
  prefix: string,
  geometry: BlobGeometry,
  lighting: BlobLightingDefinition,
  material: BlobMaterialDefinition,
  plan: BlobSurfacePlan,
  noise: SurfaceNoiseLayer[],
  textureUnderSurface = '',
  textureTop = '',
  perPixelMarkup = ''
): string => {
  const clipId = `${prefix}-clip`
  const layers: string[] = []

  // 1. The volume ramp is the fill itself, so there is no flat base color
  //    anywhere in the result. With the per-pixel renderer the filter replaces
  //    this layer, because it already carries its own lighting.
  layers.push(perPixelMarkup || `<path d="${geometry.path}" fill="url(#${prefix}-volume)"/>`)
  if (perPixelMarkup) {
    // Everything below tints and finishes a body that is already lit. The
    // cavity and rim stay: the filter resolves diffuse and specular, but the
    // edge treatment is still an authored layer.
    for (const layer of noise) {
      layers.push(
        clipped(
          clipId,
          blended(
            layer.blend,
            layer.opacity,
            fullFrameRect('transparent', `filter="url(#${layer.filterId})"`)
          )
        )
      )
    }
    // Edge treatments belong under the finish here too — same material, same
    // authored edge, whatever the renderer.
    if (plan.edgeShade) {
      const inset = buildBlobInsetPath(geometry, lighting.edgeShade.insetFactor)
      layers.push(
        clipped(
          clipId,
          blended(
            material.blend.cavity,
            lighting.edgeShade.opacity,
            outlineStroke(inset, lighting.edgeShade.color, lighting.edgeShade.width, '')
          )
        )
      )
    }
    if (textureUnderSurface) {
      // The finish belongs here too. The per-pixel body is lit by its own
      // filter, but it is the same material, and without this band the two
      // renderers disagreed about what "plush" means: measured texture 2.1
      // against the field renderer's 5.0 on the same cells.
      layers.push(textureUnderSurface)
    }
    // Parity with the field path: the fur lifts what it covers, so the shadow
    // passes have to paint after it or the per-pixel body never leaves its
    // ambient floor (measured p05 stuck at 73-88 against the field's 46-60).
    if (plan.wash) {
      layers.push(
        clipped(
          clipId,
          blended(material.blend.shadow, 1, fullFrameRect(`url(#${prefix}-wash-shadow)`))
        )
      )
    }
    if (plan.coreShadow) {
      layers.push(
        clipped(clipId, blended(material.blend.shadow, 1, fullFrameRect(`url(#${prefix}-core)`)))
      )
    }
    if (plan.cavity) {
      const inset = buildBlobInsetPath(geometry, lighting.cavity.insetFactor)
      layers.push(
        clipped(
          clipId,
          blended(
            material.blend.cavity,
            lighting.cavity.opacity,
            outlineStroke(
              inset,
              lighting.cavity.color,
              lighting.cavity.width,
              `${prefix}-cavity-blur`
            )
          )
        )
      )
    }
    if (plan.rim) {
      const inset = buildBlobInsetPath(geometry, lighting.rim.insetFactor)
      layers.push(
        clipped(
          clipId,
          `<g mask="url(#${prefix}-rim-mask)">` +
            blended(
              material.blend.light,
              lighting.rim.opacity,
              outlineStroke(inset, lighting.rim.color, lighting.rim.width, `${prefix}-rim-blur`)
            ) +
            '</g>'
        )
      )
    }
    // Parity with the field path: the finish's top layers paint after the
    // shadows there, and the per-pixel body is the same material wearing the
    // same authored highlight. Their positions come from the rig, not from
    // the height filter, so the two renderers agree about where the light is.
    if (plan.sheen) {
      layers.push(
        clipped(
          clipId,
          blended(
            material.blend.sheen,
            lighting.sheen.opacity,
            fullFrameRect(`url(#${prefix}-sheen)`)
          )
        )
      )
    }
    if (plan.specular) {
      layers.push(
        clipped(
          clipId,
          blended(
            material.blend.light,
            lighting.specular.opacity,
            `<ellipse cx="${format(lighting.specular.cx)}" cy="${format(lighting.specular.cy)}"` +
              ` rx="${format(lighting.specular.rx)}" ry="${format(lighting.specular.ry)}"` +
              ` fill="url(#${prefix}-specular)"` +
              ` transform="rotate(${format(lighting.specular.rotation)} ${format(
                lighting.specular.cx
              )} ${format(lighting.specular.cy)})"/>`
          )
        )
      )
    }
    return `<g style="isolation:isolate">${layers.join('')}${textureTop}</g>`
  }

  if (plan.wash) {
    layers.push(
      clipped(clipId, blended(material.blend.light, 1, fullFrameRect(`url(#${prefix}-wash-light)`)))
    )
  }

  if (plan.fillLight) {
    layers.push(
      clipped(clipId, blended(material.blend.light, 1, fullFrameRect(`url(#${prefix}-fill)`)))
    )
  }

  // Multi-spot colour fields (FASI 9, 56). They sit directly on the lit body
  // and below the shadow passes, so they tint the material rather than
  // painting over it. Each one is a camera-anchored radial layer whose colour
  // was resolved in OKLab from the material palette.
  for (const [index, spot] of lighting.colorFields.entries()) {
    if (spot.opacity <= 0.002) continue
    layers.push(
      clipped(
        clipId,
        blended(spot.blend, spot.opacity, fullFrameRect(`url(#${prefix}-spot-${index})`))
      )
    )
  }

  // Surface noise bands sit above the volume and below every highlight, so the
  // material reads as texture rather than as a dirty silhouette.
  for (const layer of noise) {
    layers.push(
      clipped(
        clipId,
        blended(
          layer.blend,
          layer.opacity,
          fullFrameRect('transparent', `filter="url(#${layer.filterId})"`)
        )
      )
    )
  }

  // Edge treatments belong under the finish: they are surface detail, and
  // letting the fur soften them is what keeps the silhouette from reading as
  // a decal — while still measuring as texture.
  if (plan.edgeShade) {
    const inset = buildBlobInsetPath(geometry, lighting.edgeShade.insetFactor)
    layers.push(
      clipped(
        clipId,
        blended(
          material.blend.cavity,
          lighting.edgeShade.opacity,
          outlineStroke(inset, lighting.edgeShade.color, lighting.edgeShade.width, '')
        )
      )
    )
  }

  if (plan.cavity) {
    const inset = buildBlobInsetPath(geometry, lighting.cavity.insetFactor)
    layers.push(
      clipped(
        clipId,
        blended(
          material.blend.cavity,
          lighting.cavity.opacity,
          outlineStroke(
            inset,
            lighting.cavity.color,
            lighting.cavity.width,
            `${prefix}-cavity-blur`
          )
        )
      )
    )
  }

  // The studio texture lands between the surface bands and the highlights, so
  // it reads as a finish on the material rather than as a filter on the shape.
  if (textureUnderSurface) layers.push(textureUnderSurface)

  // The shadow passes paint *after* the finish, not under it. Measured: with
  // the plush fur on top, the white soft-light film lifted the shadow side's
  // 5th percentile by 24 luminance points and erased most of the core shadow,
  // which is exactly the tonal range the reference artwork has and a fur
  // coat cannot be allowed to take away. A shadow falls on the finish.
  if (plan.wash) {
    layers.push(
      clipped(
        clipId,
        blended(material.blend.shadow, 1, fullFrameRect(`url(#${prefix}-wash-shadow)`))
      )
    )
  }

  if (plan.coreShadow) {
    layers.push(
      clipped(clipId, blended(material.blend.shadow, 1, fullFrameRect(`url(#${prefix}-core)`)))
    )
  }

  if (plan.rim) {
    const inset = buildBlobInsetPath(geometry, lighting.rim.insetFactor)
    layers.push(
      clipped(
        clipId,
        `<g mask="url(#${prefix}-rim-mask)">` +
          blended(
            material.blend.light,
            lighting.rim.opacity,
            outlineStroke(inset, lighting.rim.color, lighting.rim.width, `${prefix}-rim-blur`)
          ) +
          '</g>'
      )
    )
  }

  if (plan.sheen) {
    layers.push(
      clipped(
        clipId,
        blended(
          material.blend.sheen,
          lighting.sheen.opacity,
          fullFrameRect(`url(#${prefix}-sheen)`)
        )
      )
    )
  }

  if (plan.specular) {
    layers.push(
      clipped(
        clipId,
        blended(
          material.blend.light,
          lighting.specular.opacity,
          `<ellipse cx="${format(lighting.specular.cx)}" cy="${format(lighting.specular.cy)}"` +
            ` rx="${format(lighting.specular.rx)}" ry="${format(lighting.specular.ry)}"` +
            ` fill="url(#${prefix}-specular)"` +
            ` transform="rotate(${format(lighting.specular.rotation)} ${format(
              lighting.specular.cx
            )} ${format(lighting.specular.cy)})"/>`
        )
      )
    )
  }

  return `<g style="isolation:isolate">${layers.join('')}${textureTop}</g>`
}

/**
 * The face is painted last and never blends with the material, so the eyes stay
 * readable on every preset (FASI 22).
 */
const buildFace = (config: BlobConfig, material: BlobMaterialDefinition): string => {
  if (!config.expression.enabled) return ''
  const { expression } = config
  const eyeY = expression.eyeHeight
  const eyeColor = shiftColor(material.palette.base, { lightness: 0.42, chroma: 0.12 })
  const pupilColor = shiftColor(material.palette.shadow, { lightness: -0.5, chroma: 0.5 })
  const parts: string[] = []

  for (const side of [-1, 1] as const) {
    const cx = side * expression.eyeSpacing
    parts.push(
      `<ellipse cx="${format(cx)}" cy="${format(eyeY)}" rx="${format(expression.eyeRadius)}"` +
        ` ry="${format(expression.eyeRadius * 1.08)}" fill="${eyeColor}"/>`
    )
    parts.push(
      `<circle cx="${format(cx + side * 1.5)}" cy="${format(eyeY + 1)}"` +
        ` r="${format(expression.pupilRadius)}" fill="${pupilColor}"/>`
    )
    parts.push(
      `<circle cx="${format(cx - side * 3)}" cy="${format(eyeY - expression.pupilRadius * 0.7)}"` +
        ` r="${format(expression.pupilRadius * 0.34)}" fill="#ffffff" opacity="0.9"/>`
    )
  }

  parts.push(
    `<path d="${smilePath(0, expression.mouthY, expression.mouthWidth, expression.mouthCurve)}"` +
      ` fill="none" stroke="${material.palette.shadow}" stroke-width="${format(4)}"` +
      ' stroke-linecap="round"/>'
  )

  return `<g pointer-events="none">${parts.join('')}</g>`
}

const buildGroundShadow = (prefix: string, geometry: BlobGeometry): string => {
  const { center, radius } = geometry
  // No blend mode: the export can land on any background, and `multiply` over a
  // transparent SVG canvas is a no-op in several renderers.
  return (
    `<ellipse cx="${format(center.x)}" cy="${format(center.y + radius * 1.18)}"` +
    ` rx="${format(radius * 0.95)}" ry="${format(radius * 0.42)}"` +
    ` fill="url(#${prefix}-shadow)"/>`
  )
}

/**
 * The neutral camera pose used when the caller supplies none.
 *
 * The dot inherits the fork's projection and orientation when a pose is
 * available; with no pose it stands in the identity frame, which is the same
 * rest condition the studio uses for a neutral avatar.
 */
export const restPose = (): AvatarPose => {
  const expression: Expression = {
    id: 'dot',
    headX: 0,
    headY: 0,
    headZ: 0,
    widthLeft: 40,
    widthRight: 40,
    heightLeft: 40,
    heightRight: 40,
    spacing: 70,
    positionXLeft: 0,
    positionXRight: 0,
    positionYLeft: 0,
    positionYRight: 0,
    leftAngle: 0,
    rightAngle: 0,
    perspective: 0.06,
    eyeMotion: 'none',
    bodyMotion: 'none',
  }
  return poseFromExpression(expression)
}

/**
/**
 * The dot's own shape expressed as the fork's `SurfaceConfig` (DOT MODE).
 *
 * Exported because the WebGL2 impostor lights the *same* projected surface:
 * the silhouette still comes from the dot's parametric outline, but normals,
 * perspective and curvature are read from the fork's superellipsoid, so no
 * renderer re-derives geometry.
 */
export const dotSurfaceConfig = (config: BlobConfig): SurfaceConfig => ({
  type: 'softDot',
  width: config.shape.radius * 2 * config.shape.elongationX,
  height: config.shape.radius * 2 * config.shape.elongationY,
  // A depth below the silhouette keeps the projected horizon close to the
  // outline while still giving the material a real z to light.
  depth: config.shape.radius * 2 * Math.max(0.35, Math.min(1, config.shape.elongationY)),
  // The outline's roundness parameter doubles as the surface roundness, so
  // a boxy silhouette is also lit as a boxy object.
  roundness: 1 + (1 - config.shape.smoothness) * 1.4,
  seed: config.shape.seed,
})

/**
 * The dot's parametric surface projected through the fork's own geometry.
 * Shared by the SVG serializer and the WebGL2 impostor so both light the same
 * object (DOT MODE contract).
 */
export const buildDotSurfaceField = (pose: AvatarPose, config: BlobConfig): SurfaceField =>
  buildSurfaceField(pose, dotSurfaceConfig(config))

/** Assembles every layer into the scene description shared by React and export. */
export const buildBlobScene = (input: BlobConfig, options: BlobSvgOptions = {}): BlobScene => {
  const config = normalizeBlobConfig(input)
  const prefix = options.idPrefix ?? 'blob'
  const quality = options.quality ?? config.quality
  const pose = options.pose ?? config.pose ?? restPose()

  const geometry = buildBlobGeometry(config.shape)
  const material = createBlobMaterial(config.material)
  const field = options.field ?? buildDotSurfaceField(pose, config)
  const lighting = buildBlobLighting(
    config.lighting,
    material,
    field,
    quality,
    config.shape.seed,
    material.deformation
  )
  const plan = resolveSurfacePlan(quality, material)
  const noise = buildSurfaceNoiseLayers(material, config.shape.seed, plan, prefix)

  // The studio texture shares the blob outline as its clip, so felt, plush,
  // glossy and neon all land on the procedural body instead of fighting it.
  const texture =
    options.texture?.type && options.texture.type !== 'none' ? options.texture : undefined
  const textureShader = texture
    ? createTextureShader(texture, `${prefix}-clip`, `${prefix}-tex`)
    : null

  const glow = textureShader?.glowFilterId
    ? `<path d="${geometry.path}" fill="${material.palette.base}" filter="url(#${textureShader.glowFilterId})" pointer-events="none"/>`
    : ''

  // The per-pixel path is opt-in: it costs a filter chain, so it is offered
  // rather than assumed, and the field renderer stays the default.
  const perPixel =
    config.renderer === 'perPixel'
      ? buildPerPixelLayer({
          idPrefix: prefix,
          field,
          lighting,
          material,
          silhouettePath: geometry.path,
          samples: quality === 'ultra' ? 48 : 28,
          seed: config.shape.seed,
          deformation: material.deformation,
        })
      : null

  return {
    config,
    geometry,
    field,
    material,
    lighting,
    plan,
    noise,
    defs:
      buildDefs(prefix, geometry, lighting, noise, textureShader?.defs ?? '') +
      (perPixel?.defs ?? ''),
    body: buildBody(
      prefix,
      geometry,
      lighting,
      material,
      plan,
      noise,
      textureShader?.underEye ?? '',
      textureShader?.top ?? '',
      perPixel?.shape ?? ''
    ),
    face: buildFace(config, material),
    shadow: buildGroundShadow(prefix, geometry),
    debug: buildBlobDebugOverlay({
      flags: options.debug ?? [],
      geometry,
      field,
      lighting,
      stops: lighting.volume.stops,
      seed: config.shape.seed,
    }).markup,
    glow,
    textureUnderSurface: textureShader?.underEye ?? '',
    textureTop: textureShader?.top ?? '',
  }
}

/** Complete standalone SVG document. Deterministic for a given config. */
export const renderBlobToSvg = (input: BlobConfig, options: BlobSvgOptions = {}): string => {
  const config = normalizeBlobConfig(input)
  const scene = buildBlobScene(config, options)
  const motion = sampleBlobMotion(config.motion, options.motionTime ?? 0)
  const viewBox = options.viewBox ?? `${-FRAME / 2} ${-FRAME / 2} ${FRAME} ${FRAME}`
  const size = options.width ?? '100%'
  const height = options.height ?? size
  const showFace = options.withExpression ?? true

  const transform =
    `translate(${format(motion.translateX)} ${format(motion.translateY)})` +
    ` rotate(${format(motion.rotation)})` +
    ` scale(${format(motion.scaleX)} ${format(motion.scaleY)})`

  const accessibility = options.label
    ? `role="img" aria-label="${options.label}"`
    : 'aria-hidden="true" focusable="false"'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}"` +
    ` height="${height}" ${accessibility}>` +
    `<defs>${scene.defs}</defs>` +
    (options.background
      ? fullFrameRect(options.background)
      : options.groundShadow === false
        ? ''
        : scene.shadow) +
    scene.glow +
    `<g transform="${transform}">${scene.body}${showFace ? scene.face : ''}${scene.debug}</g>` +
    '</svg>'
  )
}
