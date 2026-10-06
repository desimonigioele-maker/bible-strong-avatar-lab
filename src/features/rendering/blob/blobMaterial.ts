/**
 * Material factory (FASI 9, 10, 32).
 *
 * `createBlobMaterial` returns a *description*, not markup and not a React
 * element. The SVG renderer consumes it today; a future GPU renderer can
 * consume the very same object without the data model changing (FASE 57).
 */

import { normalizeColor, shiftColor } from './blobColor'
import { clamp01 } from './blobUtils'
import { blobMaterialTypes, type BlobMaterialConfig, type BlobMaterialType } from './blobTypes'

const lerpClamped = (from: number, to: number, t: number): number => from + (to - from) * t

export type BlobPalette = {
  base: string
  midtone: string
  highlight: string
  sheen: string
  rim: string
  core: string
  shadow: string
  cavity: string
}

/**
 * Per-type response. These are multipliers on the user-facing knobs, so a
 * preset picks a *character* and the sliders stay meaningful inside it.
 */
type MaterialProfile = {
  /** Scales the specular lobe. Matte is 0, glass is highest. */
  specular: number
  /** Exponent bias; large values tighten the highlight. */
  specularPower: number
  sheen: number
  microNoise: number
  fiber: number
  grain: number
  /** Extra light wrap for translucent-looking materials. */
  lightSpread: number
  rimBoost: number
}

export const materialProfiles: Record<BlobMaterialType, MaterialProfile> = {
  matte: {
    specular: 0,
    specularPower: 6,
    sheen: 0.04,
    microNoise: 0.35,
    fiber: 0.2,
    grain: 0.5,
    lightSpread: 0.9,
    rimBoost: 0.35,
  },
  clay: {
    specular: 0.5,
    specularPower: 14,
    sheen: 0.12,
    microNoise: 0.5,
    fiber: 0.25,
    grain: 0.7,
    lightSpread: 0.75,
    rimBoost: 0.5,
  },
  soft: {
    specular: 0.45,
    specularPower: 18,
    sheen: 0.3,
    microNoise: 0.7,
    fiber: 0.45,
    grain: 0.6,
    lightSpread: 0.6,
    rimBoost: 0.7,
  },
  plush: {
    specular: 0.18,
    specularPower: 9,
    sheen: 0.62,
    microNoise: 1.15,
    fiber: 1.5,
    grain: 0.45,
    lightSpread: 0.8,
    rimBoost: 0.8,
  },
  gel: {
    specular: 1.15,
    specularPower: 46,
    sheen: 0.35,
    microNoise: 0.45,
    fiber: 0.1,
    grain: 0.3,
    lightSpread: 0.35,
    rimBoost: 1.2,
  },
  glass: {
    specular: 1.9,
    specularPower: 96,
    sheen: 0.5,
    microNoise: 0.25,
    fiber: 0.05,
    grain: 0.25,
    lightSpread: 0.25,
    rimBoost: 1.5,
  },
  // Pearl: smooth body, broad low-power specular, sheen-forward — reads as
  // nacre rather than as glass (specular power sits between soft and gel).
  pearl: {
    specular: 0.9,
    specularPower: 32,
    sheen: 0.72,
    microNoise: 0.3,
    fiber: 0.12,
    grain: 0.32,
    lightSpread: 0.45,
    rimBoost: 1.05,
  },
}

export type BlobMaterialDefinition = {
  type: BlobMaterialType
  palette: BlobPalette
  roughness: number
  /** Final specular strength after the profile multiplier. */
  specularStrength: number
  specularPower: number
  sheen: number
  fiber: number
  grain: number
  macroNoise: number
  microNoise: number
  colorVariation: number
  lightSpread: number
  rimBoost: number
  /** Amplitude of the seeded normal deformation. */
  deformation: number
  /** How many overlapping colour fields the material paints. */
  colorSpots: number
  /** Blend modes are part of the definition so both renderers agree. */
  blend: {
    volume: string
    shadow: string
    light: string
    cavity: string
    macro: string
    micro: string
    sheen: string
  }
}

/** Small FNV-1a so each base color keeps a stable, reproducible tint bias. */
const stableHash = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967296
}

/**
 * Derives a coherent ramp from a single base color (FASE 5). Highlights move up
 * in lightness and stay close to the base in chroma (the reference artwork's
 * bright zones are still saturated), shadows move down and cool slightly; the
 * tiny per-color hue bias is what stops several blobs sharing a base from
 * looking like the same material printed twice.
 */
export const deriveBlobPalette = (config: BlobMaterialConfig): BlobPalette => {
  const base = normalizeColor(config.baseColor)
  const hueBias = (stableHash(base) - 0.5) * 10 * clamp01(config.colorVariation)
  // An explicit secondary color takes over the midtone, which is how a
  // two-tone material stays possible without a second config field.
  const midtoneSource = config.secondaryColor ? normalizeColor(config.secondaryColor) : base

  return {
    base,
    midtone: shiftColor(midtoneSource, { lightness: 0.07, chroma: 1.04, hue: hueBias * 0.4 }),
    // The highlight used to run +0.34 in lightness, which paints the whole
    // bright zone a near-white with saturation 0.15-0.27: the ramp's brightest
    // third was the least chromatic part of the body, and the reference
    // artwork does the opposite (its bright zones stay saturated). A modest
    // lift with chroma pushed to the gamut edge keeps the top of the ramp
    // bright enough for the tonal range and chromatic enough for saturation.
    highlight: normalizeColor(
      config.highlightColor ?? '',
      shiftColor(base, { lightness: 0.26, chroma: 1.2, hue: 6 + hueBias })
    ),
    sheen: shiftColor(base, { lightness: 0.46, chroma: 0.6, hue: 10 + hueBias }),
    rim: shiftColor(base, { lightness: 0.34, chroma: 0.95, hue: -14 }),
    core: shiftColor(base, { lightness: -0.15, chroma: 0.96, hue: -5 }),
    shadow: normalizeColor(
      config.shadowColor ?? '',
      shiftColor(base, { lightness: -0.4, chroma: 0.94, hue: -16 + hueBias * 0.3 })
    ),
    cavity: shiftColor(base, { lightness: -0.46, chroma: 0.85, hue: -20 }),
  }
}

/** Flat-versus-material sanity helpers used by the visual test page. */
export const isFlatMaterial = (material: BlobMaterialDefinition): boolean =>
  material.specularStrength < 0.04 &&
  material.macroNoise < 0.05 &&
  material.microNoise < 0.05 &&
  material.grain < 0.05

export const createBlobMaterial = (config: BlobMaterialConfig): BlobMaterialDefinition => {
  const type = blobMaterialTypes.includes(config.type) ? config.type : 'soft'
  const profile = materialProfiles[type]
  const roughness = clamp01(config.roughness)

  return {
    type,
    palette: deriveBlobPalette(config),
    roughness,
    // Rougher surfaces spread the highlight: a low-power lobe reads as velvet,
    // a high-power lobe as polished. Coupling power to roughness keeps the two
    // sliders from contradicting each other.
    specularStrength: clamp01(config.specular * profile.specular * (1.35 - roughness * 0.7)),
    specularPower: Math.max(
      1,
      config.specular > 0
        ? profile.specularPower * lerpClamped(0.6, 2.2, clamp01(config.specular))
        : profile.specularPower
    ),
    sheen: clamp01(config.sheen * profile.sheen),
    fiber: clamp01(config.fiber * profile.fiber),
    grain: clamp01(config.grain * profile.grain),
    macroNoise: clamp01(config.macroNoise),
    microNoise: clamp01(config.microNoise * profile.microNoise),
    colorVariation: clamp01(config.colorVariation),
    lightSpread: profile.lightSpread,
    rimBoost: profile.rimBoost,
    deformation: clamp01(config.deformation),
    // A count, not a 0..1 amount: clamping it as a fraction would collapse
    // every preset to a single field.
    colorSpots: Math.max(1, Math.min(5, Math.round(config.colorSpots))),
    blend: {
      volume: 'normal',
      shadow: 'multiply',
      light: 'screen',
      cavity: 'multiply',
      macro: 'soft-light',
      micro: 'overlay',
      sheen: 'soft-light',
    },
  }
}
