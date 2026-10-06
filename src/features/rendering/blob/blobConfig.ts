/**
 * Config normalization and validation (FASI 41, 66).
 *
 * Every public entry point runs its input through `normalizeBlobConfig`, so
 * downstream code can assume finite numbers, known enum members and in-range
 * values. `validateBlobConfig` states those invariants explicitly and is used
 * by the tests to keep them honest.
 */

import type { AvatarPose } from '@bible-strong/avatar-core'
import {
  defaultSoftDotParams,
  dotSoftnessPresets,
  type DotSurfaceParams,
  type SoftDotSurfaceParams,
} from '@bible-strong/avatar-core'

import { blobMaterialPresets, findBlobMaterialPreset } from './blobPresets'
import {
  blobMaterialTypes,
  blobRenderers,
  blobShapeFamilies,
  createDefaultBlobConfig,
  renderQualities,
  type BlobConfig,
  type BlobMaterialType,
  type BlobShapeFamily,
  type RenderQuality,
} from './blobTypes'
import { normalizeColor } from './blobColor'
import { clampRange, normalizeSeed } from './blobUtils'

const number = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return numeric < min ? min : numeric > max ? max : numeric
}

const optionalColor = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? normalizeColor(value, '') : undefined

const member = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const normalizeBlobConfig = (value: unknown): BlobConfig => {
  const defaults = createDefaultBlobConfig()
  const root = record(value)
  const shape = record(root.shape)
  const lighting = record(root.lighting)
  const material = record(root.material)
  const motion = record(root.motion)
  const expression = record(root.expression)

  const baseColor = normalizeColor(material.baseColor, defaults.material.baseColor)
  const secondaryColor = optionalColor(material.secondaryColor)
  const highlightColor = optionalColor(material.highlightColor)
  const shadowColor = optionalColor(material.shadowColor)

  return {
    shape: {
      family: member(shape.family, blobShapeFamilies, defaults.shape.family),
      seed: normalizeSeed(shape.seed ?? defaults.shape.seed),
      pointCount: Math.round(number(shape.pointCount, 12, 512, defaults.shape.pointCount)),
      radius: number(shape.radius, 8, 400, defaults.shape.radius),
      irregularity: number(shape.irregularity, 0, 1, defaults.shape.irregularity),
      asymmetry: number(shape.asymmetry, 0, 1, defaults.shape.asymmetry),
      elongationX: number(shape.elongationX, 0.2, 3, defaults.shape.elongationX),
      elongationY: number(shape.elongationY, 0.2, 3, defaults.shape.elongationY),
      rotation: number(shape.rotation, -180, 180, defaults.shape.rotation),
      smoothness: number(shape.smoothness, 0, 1, defaults.shape.smoothness),
      lobeCount: number(shape.lobeCount, 0, 24, defaults.shape.lobeCount),
      lobeStrength: number(shape.lobeStrength, 0, 1, defaults.shape.lobeStrength),
      deformationFrequency: number(
        shape.deformationFrequency,
        0.1,
        8,
        defaults.shape.deformationFrequency
      ),
      deformationAmplitude: number(
        shape.deformationAmplitude,
        0,
        1,
        defaults.shape.deformationAmplitude
      ),
    },
    lighting: {
      lightX: number(lighting.lightX, -1, 1, defaults.lighting.lightX),
      lightY: number(lighting.lightY, -1, 1, defaults.lighting.lightY),
      lightZ: number(lighting.lightZ, 0.05, 1, defaults.lighting.lightZ),
      intensity: number(lighting.intensity, 0, 1.5, defaults.lighting.intensity),
      softness: number(lighting.softness, 0, 1, defaults.lighting.softness),
      ambient: number(lighting.ambient, 0, 1, defaults.lighting.ambient),
      shadowStrength: number(lighting.shadowStrength, 0, 1, defaults.lighting.shadowStrength),
      rimStrength: number(lighting.rimStrength, 0, 1, defaults.lighting.rimStrength),
      rimWidth: number(lighting.rimWidth, 0, 1, defaults.lighting.rimWidth),
      cavityStrength: number(lighting.cavityStrength, 0, 1, defaults.lighting.cavityStrength),
      specularStrength: number(lighting.specularStrength, 0, 1, defaults.lighting.specularStrength),
      specularPower: number(lighting.specularPower, 1, 128, defaults.lighting.specularPower),
      fillIntensity: number(lighting.fillIntensity, 0, 1, defaults.lighting.fillIntensity),
      aoStrength: number(lighting.aoStrength, 0, 1, defaults.lighting.aoStrength),
      rimPower: number(lighting.rimPower, 0.5, 12, defaults.lighting.rimPower),
      sheenPower: number(lighting.sheenPower, 0.5, 12, defaults.lighting.sheenPower),
    },
    material: {
      type: member(material.type, blobMaterialTypes, defaults.material.type),
      baseColor,
      ...(secondaryColor ? { secondaryColor } : {}),
      ...(highlightColor ? { highlightColor } : {}),
      ...(shadowColor ? { shadowColor } : {}),
      roughness: number(material.roughness, 0, 1, defaults.material.roughness),
      grain: number(material.grain, 0, 1, defaults.material.grain),
      macroNoise: number(material.macroNoise, 0, 1, defaults.material.macroNoise),
      microNoise: number(material.microNoise, 0, 1, defaults.material.microNoise),
      fiber: number(material.fiber, 0, 1, defaults.material.fiber),
      sheen: number(material.sheen, 0, 1, defaults.material.sheen),
      specular: number(material.specular, 0, 1, defaults.material.specular),
      // The clamp encodes the intent from FASI 11: micro colour variation is a
      // refinement, not a look. Accepting 1 here would let a config wash the
      // material out entirely.
      colorVariation: number(material.colorVariation, 0, 0.05, defaults.material.colorVariation),
      deformation: number(material.deformation, 0, 0.3, defaults.material.deformation),
      colorSpots: Math.round(number(material.colorSpots, 1, 5, defaults.material.colorSpots)),
    },
    motion: {
      enabled: motion.enabled !== false,
      breathing: number(motion.breathing, 0, 0.2, defaults.motion.breathing),
      breathingSpeed: number(motion.breathingSpeed, 0, 4, defaults.motion.breathingSpeed),
      float: number(motion.float, 0, 0.2, defaults.motion.float),
      floatSpeed: number(motion.floatSpeed, 0, 4, defaults.motion.floatSpeed),
      rotation: number(motion.rotation, 0, 15, defaults.motion.rotation),
      rotationSpeed: number(motion.rotationSpeed, 0, 4, defaults.motion.rotationSpeed),
      surfaceDrift: number(motion.surfaceDrift, 0, 1, defaults.motion.surfaceDrift),
      surfaceDriftSpeed: number(motion.surfaceDriftSpeed, 0, 4, defaults.motion.surfaceDriftSpeed),
    },
    expression: {
      enabled: expression.enabled !== false,
      eyeSpacing: number(expression.eyeSpacing, 0, 80, defaults.expression.eyeSpacing),
      eyeHeight: number(expression.eyeHeight, -60, 60, defaults.expression.eyeHeight),
      eyeRadius: number(expression.eyeRadius, 0, 30, defaults.expression.eyeRadius),
      pupilRadius: number(expression.pupilRadius, 0, 20, defaults.expression.pupilRadius),
      mouthWidth: number(expression.mouthWidth, 0, 80, defaults.expression.mouthWidth),
      mouthCurve: number(expression.mouthCurve, -20, 20, defaults.expression.mouthCurve),
      mouthY: number(expression.mouthY, 0, 100, defaults.expression.mouthY),
    },
    quality: member(root.quality, renderQualities, defaults.quality),
    renderer: member(root.renderer, blobRenderers, defaults.renderer),
    // The pose is a live camera frame, not a document field, so it is never
    // normalized: it is either a well-formed pose or it is dropped.
    ...(isAvatarPose(root.pose) ? { pose: root.pose } : {}),
  }
}

/** Structural guard for the optional camera pose. */
const isAvatarPose = (value: unknown): value is AvatarPose => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AvatarPose>
  return (
    !!candidate.expression &&
    typeof candidate.expression === 'object' &&
    Array.isArray(candidate.orientation) &&
    candidate.orientation.length === 4
  )
}

/**
 * Builds a dot config straight from persisted surface parameters.
 *
 * The app's `features/avatar/softDot` bridge does the same thing for React, but
 * the standalone runtime has no access to it. Keeping the conversion here, in
 * the React-free domain layer, is what guarantees the exported avatar and the
 * studio preview are rendered by the same code (FASI 35, 67).
 */
export const blobConfigFromParams = (params?: SoftDotSurfaceParams): BlobConfig =>
  normalizeBlobConfig({ ...createDefaultBlobConfig(), ...mapParamsToConfig(params) })

/** Flattens the stored knobs onto the richer renderer model. */
const mapParamsToConfig = (
  params: SoftDotSurfaceParams = defaultSoftDotParams
): Record<string, unknown> => {
  const defaults = createDefaultBlobConfig()
  const preset = findBlobMaterialPreset(params.presetId)
  return {
    quality: params.quality,
    shape: { ...defaults.shape, seed: params.seed },
    lighting: {
      ...defaults.lighting,
      lightX: params.lightX,
      lightY: params.lightY,
      lightZ: params.lightZ,
      intensity: params.intensity,
      softness: params.softness,
      ambient: params.ambient,
      fillIntensity: params.fillIntensity,
      aoStrength: params.aoStrength,
      rimStrength: params.rimStrength,
      cavityStrength: params.cavityStrength,
    },
    material: {
      ...(preset?.material ?? defaults.material),
      baseColor: params.color,
      roughness: params.roughness,
      sheen: params.sheen,
      fiber: params.fiber,
      grain: params.grain,
      macroNoise: params.macroNoise,
      microNoise: params.microNoise,
      specular: params.specular,
      colorVariation: params.colorVariation,
      deformation: params.deformation,
      colorSpots: params.colorSpots,
    },
    renderer: params.renderer,
    // The studio's own eyes carry the expressions, so the dot never paints a
    // second face on top of them.
    expression: { ...defaults.expression, enabled: false },
  }
}

/**
 * The inverse of `blobConfigFromParams`.
 *
 * The inspector's randomize builds a config and writes it back, so the reverse
 * mapping has to exist and has to live here too: keeping it next to the
 * forward one is what makes the round trip lossless instead of quietly
 * dropping a field the author just changed.
 */
export const blobParamsFromConfig = (config: BlobConfig): SoftDotSurfaceParams => {
  const normalized = normalizeBlobConfig(config)
  const preset = blobMaterialPresets.find(
    entry =>
      entry.material.type === normalized.material.type &&
      entry.material.baseColor.toLowerCase() === normalized.material.baseColor.toLowerCase()
  )
  return {
    seed: normalized.shape.seed,
    presetId: preset?.id ?? normalized.material.type,
    color: normalized.material.baseColor,
    roughness: normalized.material.roughness,
    sheen: normalized.material.sheen,
    fiber: normalized.material.fiber,
    grain: normalized.material.grain,
    macroNoise: normalized.material.macroNoise,
    microNoise: normalized.material.microNoise,
    specular: normalized.material.specular,
    lightX: normalized.lighting.lightX,
    lightY: normalized.lighting.lightY,
    lightZ: normalized.lighting.lightZ,
    intensity: normalized.lighting.intensity,
    softness: normalized.lighting.softness,
    ambient: normalized.lighting.ambient,
    fillIntensity: normalized.lighting.fillIntensity,
    aoStrength: normalized.lighting.aoStrength,
    rimStrength: normalized.lighting.rimStrength,
    cavityStrength: normalized.lighting.cavityStrength,
    quality: normalized.quality,
    renderer: normalized.renderer,
    face: normalized.expression.enabled,
    colorVariation: normalized.material.colorVariation,
    deformation: normalized.material.deformation,
    colorSpots: normalized.material.colorSpots,
  }
}

export const isBlobShapeFamily = (value: unknown): value is BlobShapeFamily =>
  typeof value === 'string' && (blobShapeFamilies as readonly string[]).includes(value)

export const isBlobMaterialType = (value: unknown): value is BlobMaterialType =>
  typeof value === 'string' && (blobMaterialTypes as readonly string[]).includes(value)

export const isRenderQuality = (value: unknown): value is RenderQuality =>
  typeof value === 'string' && (renderQualities as readonly string[]).includes(value)

/** Returns one message per broken invariant; an empty array means "usable". */
export const validateBlobConfig = (value: unknown): string[] => {
  const problems: string[] = []
  const config = normalizeBlobConfig(value)
  const root = record(value)

  if (!isRenderQuality(root.quality)) problems.push('quality must be low|medium|high|ultra')
  if (!isBlobShapeFamily(record(root.shape).family)) problems.push('unknown shape family')
  if (!isBlobMaterialType(record(root.material).type)) problems.push('unknown material type')
  if (!/^#[0-9a-f]{6}$/.test(config.material.baseColor)) problems.push('baseColor is not #rrggbb')

  const checkRange = (label: string, actual: number, min: number, max: number) => {
    if (!Number.isFinite(actual)) problems.push(`${label} is not finite`)
    else if (actual < min || actual > max) problems.push(`${label} outside [${min}, ${max}]`)
  }

  checkRange('pointCount', config.shape.pointCount, 12, 512)
  checkRange('radius', config.shape.radius, 8, 400)
  checkRange('roughness', config.material.roughness, 0, 1)
  checkRange('breathing', config.motion.breathing, 0, 0.2)

  const numericValues = (...sources: object[]): number[] =>
    sources.flatMap(source =>
      Object.values(source as Record<string, unknown>).filter(
        (entry): entry is number => typeof entry === 'number'
      )
    )
  const numbers = numericValues(
    config.shape,
    config.lighting,
    config.material,
    config.motion,
    config.expression
  )
  if (numbers.some(entry => !Number.isFinite(entry)))
    problems.push('config contains NaN or Infinity')

  return problems
}

/** Deep structural equality for config snapshots; order-independent on objects. */
export const sameBlobConfig = (left: BlobConfig, right: BlobConfig): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

/** Roughness character per legacy softness preset (see `dotSoftnessPresets`). */
const LEGACY_SOFTNESS: Record<
  string,
  { roughness: number; sheen: number; fiber: number; grain: number }
> = {
  classic: { roughness: 0.62, sheen: 0.3, fiber: 0.2, grain: 0.14 },
  softer: { roughness: 0.72, sheen: 0.38, fiber: 0.26, grain: 0.16 },
  plush: { roughness: 0.84, sheen: 0.5, fiber: 0.32, grain: 0.2 },
}

/**
 * Maps the legacy WebGL dot params onto the renderer-independent model.
 *
 * Persisted documents still carry `surface.type === 'dot'` with the old
 * OpenAI-dots knobs (colour / wobble / SSS / softness). They now render
 * through the same BlobConfig as every other dot — the WebGL2 impostor in the
 * studio, the SVG engine in exports — so no avatar is stranded on the retired
 * Three.js path. `eyeOffsetX/Y` are not part of the material model; the eyes
 * stay the fork's SVG expression system and the canvas passes the offsets to
 * the eye layer directly.
 */
export const blobConfigFromLegacyDot = (params: DotSurfaceParams): BlobConfig => {
  const defaults = createDefaultBlobConfig()
  const softnessKey = params.softness ?? 'plush'
  const character = LEGACY_SOFTNESS[softnessKey] ?? LEGACY_SOFTNESS.plush
  // The old SSS strength drives sheen: a translucent glow at grazing angles.
  const sss = clampRange(dotSoftnessPresets[softnessKey]?.uSSSStrength ?? 0.95, 0, 1.2, 0.95)
  return normalizeBlobConfig({
    ...defaults,
    shape: {
      ...defaults.shape,
      seed: Number.isFinite(params.seed) ? params.seed : defaults.shape.seed,
    },
    material: {
      ...defaults.material,
      baseColor: normalizeColor(params.color, defaults.material.baseColor),
      secondaryColor: normalizeColor(params.sssColor, ''),
      roughness: character.roughness,
      sheen: character.sheen + sss * 0.18,
      fiber: character.fiber,
      grain: character.grain,
      deformation: clampRange(params.wobble * 1.2, 0, 0.28, defaults.material.deformation),
    },
    // The studio's own eyes carry the expressions.
    expression: { ...defaults.expression, enabled: false },
  })
}
