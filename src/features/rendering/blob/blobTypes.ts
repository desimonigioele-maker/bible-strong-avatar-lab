/**
 * Blob configuration model.
 *
 * The whole engine is a pure function of this object: same config in, same
 * SVG out. Nothing here imports React, so the studio preview, the exporter and
 * a future batch renderer all consume the same types.
 *
 * Shape, lighting, material and motion stay in separate sub-configs on
 * purpose (FASI 2, 14): a shape can be paired with any material without
 * touching geometry code, and a material can be re-tuned without invalidating
 * the silhouette.
 */

import type { AvatarPose } from '@bible-strong/avatar-core'

export const blobShapeFamilies = [
  'round',
  'elongated',
  'compressed',
  'asymmetric',
  'doubleLobe',
  'roundedSquare',
  'bean',
  'amoeba',
  'pill',
  'capsule',
  'puddle',
  'triangle',
  'diamond',
  'cloud',
] as const

export type BlobShapeFamily = (typeof blobShapeFamilies)[number]

export type BlobShapeConfig = {
  /** Base silhouette profile; the remaining fields fine-tune it. */
  family: BlobShapeFamily
  /** Deterministic seed for every noise octave and lobe phase. */
  seed: number
  /** Sampled points around the silhouette, before smoothing. */
  pointCount: number
  /** Target radius in the 300x300 authoring frame (default 108). */
  radius: number
  /** Low-frequency organic wobble, 0 to 1. */
  irregularity: number
  /** Low-frequency one-sided bias, 0 to 1. */
  asymmetry: number
  elongationX: number
  elongationY: number
  /** Silhouette rotation in degrees. */
  rotation: number
  /** 0 keeps straight chords, 1 gives a fully round Catmull-Rom curve. */
  smoothness: number
  lobeCount: number
  lobeStrength: number
  /** Low frequency used by macro surface noise, not by the outline. */
  deformationFrequency: number
  /** Amplitude of the barely-visible outline micro deformation. */
  deformationAmplitude: number
}

export type BlobLightingConfig = {
  /**
   * Key light position in normalized silhouette units, camera space.
   *
   * The coordinates are deliberately independent from the object's rotation:
   * the light stays in the scene, the body moves inside it (FASI 23, 63).
   */
  lightX: number
  lightY: number
  /** Elevation above the shape plane. 1 is directly in front. */
  lightZ: number
  intensity: number
  /** Highlight falloff, 0 hard to 1 very broad. */
  softness: number
  ambient: number
  shadowStrength: number
  rimStrength: number
  rimWidth: number
  cavityStrength: number
  specularStrength: number
  /** Exponent of the specular lobe; higher is tighter and sharper. */
  specularPower: number
  /** Fill light contribution, relative to the key. */
  fillIntensity: number
  /** Ambient-occlusion approximation; must stay very light. */
  aoStrength: number
  /** Rim falloff exponent; lower spreads the edge light. */
  rimPower: number
  /** Sheen falloff exponent, as opposed to the sheen's strength. */
  sheenPower: number
}

export const blobMaterialTypes = [
  'soft',
  'plush',
  'gel',
  'clay',
  'glass',
  'matte',
  'pearl',
] as const

export type BlobMaterialType = (typeof blobMaterialTypes)[number]

export type BlobMaterialConfig = {
  type: BlobMaterialType
  baseColor: string
  /** Optional tints; derived from baseColor in OKLCH when omitted. */
  secondaryColor?: string
  highlightColor?: string
  shadowColor?: string
  roughness: number
  grain: number
  macroNoise: number
  microNoise: number
  fiber: number
  sheen: number
  specular: number
  /**
   * Micro color variation, 0.01 to 0.05.
   *
   * Deliberately tiny: the surface must stay elegant, and anything above 0.2
   * reads as a stain rather than as a material (FASI 11).
   */
  colorVariation: number
  /**
   * Amplitude of the normal deformation (FASI 7).
   *
   * This makes the surface imperfect, not rippled, so it stays very small.
   */
  deformation: number
  /**
   * Number of overlapping colour fields (FASI 9).
   *
   * Each field is a camera-anchored spot tinted in OKLab, so a blue dot can
   * carry cyan, violet, white and deep blue without becoming a rainbow.
   */
  colorSpots: number
}

export type BlobMotionConfig = {
  enabled: boolean
  /** 0 to 1; 0.018 is a deliberately subliminal breath. */
  breathing: number
  breathingSpeed: number
  float: number
  floatSpeed: number
  rotation: number
  rotationSpeed: number
  surfaceDrift: number
  surfaceDriftSpeed: number
}

export type BlobExpressionConfig = {
  enabled: boolean
  eyeSpacing: number
  eyeHeight: number
  eyeRadius: number
  pupilRadius: number
  mouthWidth: number
  /** Negative is a frown, positive is a smile. */
  mouthCurve: number
  mouthY: number
}

export const renderQualities = ['low', 'medium', 'high', 'ultra'] as const

export type RenderQuality = (typeof renderQualities)[number]

/**
 * Which shading path paints the body.
 *
 * `field` samples the lighting model at a bounded number of points and
 * interpolates: small, cheap markup, and the right choice for a dot at typical
 * sizes. `perPixel` hands the shading to the SVG filter engine, which resolves
 * it at every pixel and costs more, so it is opt-in rather than the default.
 */
export const blobRenderers = ['field', 'perPixel'] as const

export type BlobRenderer = (typeof blobRenderers)[number]

export type BlobConfig = {
  shape: BlobShapeConfig
  lighting: BlobLightingConfig
  material: BlobMaterialConfig
  motion: BlobMotionConfig
  expression: BlobExpressionConfig
  quality: RenderQuality
  /** Shading path; see `blobRenderers`. */
  renderer: BlobRenderer
  /**
   * Live camera pose of the avatar the dot is attached to.
   *
   * Optional and never serialized: it is the seam that lets the material read
   * the fork's real projected surface, so perspective, head rotation and depth
   * are shared instead of re-derived (FASI 24).
   */
  pose?: AvatarPose
}

/**
 * The default look (FASE 50): a designed product, not a prototype. Everything
 * that would read as "developer default" stays low or zero.
 */
export const createDefaultBlobConfig = (): BlobConfig => ({
  shape: {
    family: 'round',
    seed: 918273,
    pointCount: 96,
    radius: 108,
    irregularity: 0.32,
    asymmetry: 0.12,
    elongationX: 1.02,
    elongationY: 0.97,
    rotation: -6,
    smoothness: 0.92,
    lobeCount: 3,
    lobeStrength: 0.08,
    deformationFrequency: 2.2,
    deformationAmplitude: 0.06,
  },
  lighting: {
    lightX: -0.42,
    lightY: -0.58,
    lightZ: 0.7,
    intensity: 0.92,
    softness: 0.62,
    ambient: 0.2,
    shadowStrength: 0.98,
    rimStrength: 0.42,
    rimWidth: 0.3,
    cavityStrength: 0.38,
    specularStrength: 0.35,
    specularPower: 18,
    fillIntensity: 0.34,
    aoStrength: 0.16,
    rimPower: 2.6,
    sheenPower: 3.2,
  },
  material: {
    type: 'soft',
    baseColor: '#2f8cff',
    roughness: 0.72,
    grain: 0.16,
    macroNoise: 0.34,
    microNoise: 0.18,
    fiber: 0.3,
    sheen: 0.26,
    specular: 0.3,
    colorVariation: 0.04,
    deformation: 0.05,
    colorSpots: 4,
  },
  motion: {
    enabled: true,
    breathing: 0.018,
    breathingSpeed: 0.55,
    float: 0.012,
    floatSpeed: 0.32,
    rotation: 1.2,
    rotationSpeed: 0.18,
    surfaceDrift: 0.1,
    surfaceDriftSpeed: 0.24,
  },
  expression: {
    enabled: true,
    eyeSpacing: 34,
    eyeHeight: -6,
    eyeRadius: 11,
    pupilRadius: 5,
    mouthWidth: 30,
    mouthCurve: 7,
    mouthY: 40,
  },
  quality: 'ultra',
  renderer: 'field',
})

/** Same shape, a different seed: the cheapest way to explore variants. */
export const reseedBlobConfig = (config: BlobConfig, seed: number): BlobConfig => ({
  ...config,
  shape: { ...config.shape, seed },
})
