/**
 * The DOT MATERIAL LAB matrix.
 *
 * Shared by the in-app page and the static gallery fixture. The two have to
 * agree: a tuning grid whose React version and whose static version show
 * different dots is worse than no grid at all, because the static one is what
 * gets committed as evidence.
 */

import {
  poseFromExpression,
  type AvatarTextureConfig,
  type Expression,
} from '@bible-strong/avatar-core'

import { applyBlobShapeFamily } from './blob/blobGeometry'
import { hexToOklch } from './blob/blobColor'
import { createBlobMaterial } from './blob/blobMaterial'
import { blobMaterialPresets } from './blob/blobPresets'
import { dotSurfaceConfig } from './blob/blobSvg'
import { createDefaultBlobConfig, type BlobConfig, type BlobShapeFamily } from './blob/blobTypes'
import { neutralMaterialChroma } from './dotLabMetrics'

/** Four silhouettes that between them cover the interesting cases. */
export const labShapes: { family: BlobShapeFamily; seed: number }[] = [
  { family: 'round', seed: 918273 },
  { family: 'elongated', seed: 41207 },
  { family: 'bean', seed: 77341 },
  { family: 'amoeba', seed: 20518 },
]

/** Eight materials: the extremes plus the most-used middle cases. */
/**
 * The full regression set: every soft/plush colour from the preset ramp, the
 * neutral materials (milk/clay/matte/pearl/glass stay out of the saturation
 * aggregation but keep range/texture honest), and the two field-count stress
 * presets (aurora/gel).
 */
export const labMaterials = [
  'soft-blue',
  'soft-green',
  'soft-yellow',
  'soft-pink',
  'soft-purple',
  'plush-blue',
  'plush-green',
  'plush-yellow',
  'plush-pink',
  'gel',
  'matte',
  'pearl',
  'milk',
  'clay',
  'glass',
  'aurora',
]

/** Two lighting setups that disagree about where the light comes from. */
export const labLights = [
  { id: 'key-upper-left', lightX: -0.42, lightY: -0.58 },
  { id: 'key-lower-right', lightX: 0.48, lightY: 0.52 },
]

export const labQuality = 'ultra' as const

/**
 * The finish every cell wears.
 *
 * The reference look is plush: a lab whose cells are bare cannot show what a
 * texture does to the material, and the texture is part of the material now.
 * Both render sites (the React page and the static gallery) read it from here
 * so the committed evidence and the working surface stay identical.
 */
export const labTexture: AvatarTextureConfig = { type: 'plush', intensity: 1 }

/**
 * The finish a specific cell wears: the shared plush nap, tinted with the
 * material's own highlight. White fur over a saturated body is a frosted film
 * (measured: −0.13 saturation, and the film flattens the shadow side), while
 * the reference artwork's nap always takes the body's colour. Both render
 * sites derive it the same way so the committed evidence and the working
 * surface cannot disagree.
 */
export const labTextureFor = (material: BlobConfig['material']): AvatarTextureConfig => ({
  ...labTexture,
  tint: createBlobMaterial(material).palette.highlight,
})

/**
 * Whether a cell's material is chromatic enough to be scored on saturation.
 *
 * Neutral materials (milk, matte, pale glass) are measured on range and
 * texture only, so both render sites have to agree on the classification:
 * the committed evidence and the working surface must not disagree about
 * which cells count.
 */
export const labMaterialChromatic = (material: BlobConfig['material']): boolean =>
  hexToOklch(createBlobMaterial(material).palette.base).c >= neutralMaterialChroma

export const labRestPose = () => {
  const expression: Expression = {
    id: 'lab',
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

/** The surface config the field is built from, for a given shape. */
/** Shared with the renderers: the dot's shape as the fork's `SurfaceConfig`. */
export const labSurfaceConfig = dotSurfaceConfig

/** The config a cell shows, assembled from its three grid coordinates. */
export const labCellConfig = (
  shape: { family: BlobShapeFamily; seed: number },
  materialPresetId: string,
  lighting: { lightX: number; lightY: number },
  renderer: BlobConfig['renderer'] = 'field'
): BlobConfig => {
  const base = createDefaultBlobConfig()
  const withShape = applyBlobShapeFamily(base, shape.family)
  const preset = blobMaterialPresets.find((entry: { id: string }) => entry.id === materialPresetId)
  return {
    ...withShape,
    shape: { ...withShape.shape, seed: shape.seed },
    material: { ...(preset?.material ?? base.material) },
    lighting: { ...base.lighting, ...lighting },
    quality: labQuality,
    renderer,
    // The harness is a still frame: a gallery of moving dots is a slideshow
    // and says nothing about the material.
    motion: { ...base.motion, enabled: false },
    expression: { ...base.expression, enabled: false },
  }
}

/** Every cell in the grid, in row-major order. */
export const labCells = (): {
  shape: { family: BlobShapeFamily; seed: number }
  material: string
  light: { id: string; lightX: number; lightY: number }
}[] =>
  labShapes.flatMap(shape =>
    labMaterials.flatMap(material => labLights.map(light => ({ shape, material, light })))
  )
