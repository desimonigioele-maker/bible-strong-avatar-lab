/**
 * Surface detail bands and the quality ladder (FASI 7, 23, 24, 33).
 *
 * Two separate noise bands are kept: a very low frequency macro tone that
 * breaks up the perfection of the material, and a high frequency micro grain
 * that is invisible from a distance but readable when the blob is large. Both
 * are expressed as `feTurbulence` *parameters* here; the serializer turns them
 * into filters.
 *
 * The quality ladder exists so a 32 px dot does not pay for the filters a
 * 1024 px editorial illustration needs.
 */

import { clamp01, lerp } from './blobUtils'
import type { BlobMaterialDefinition } from './blobMaterial'
import type { RenderQuality } from './blobTypes'

export type SurfaceNoiseKind = 'macro' | 'micro' | 'grain' | 'fiber'

export type SurfaceNoiseLayer = {
  kind: SurfaceNoiseKind
  /** SVG filter id, already namespaced by the caller. */
  filterId: string
  /** Space-separated pair is valid for `baseFrequency` (anisotropic fibre). */
  baseFrequency: string
  numOctaves: number
  turbulenceType: 'fractalNoise' | 'turbulence'
  seed: number
  /** Grey the color matrix flattens the noise to; sets how visible the band is. */
  tone: number
  opacity: number
  blend: string
}

export type BlobSurfacePlan = {
  volume: boolean
  /** Directional light wrap; without it the lower half reads as a flat smear. */
  wash: boolean
  coreShadow: boolean
  fillLight: boolean
  edgeShade: boolean
  cavity: boolean
  rim: boolean
  sheen: boolean
  specular: boolean
  macro: boolean
  micro: boolean
  grain: boolean
  fiber: boolean
  /** Reported for the debug overlay and the acceptance grid. */
  layerCount: number
}

/**
 * Low quality renders silhouette plus a single volume ramp; medium adds the
 * modelling passes (measured layerCount: low 3, medium 9, high 10, ultra 10 —
 * the turbulence bands are off at every quality, so ultra differs from high in
 * probe density, not in layer count).
 */
export const resolveSurfacePlan = (
  quality: RenderQuality,
  material: BlobMaterialDefinition
): BlobSurfacePlan => {
  const plan: BlobSurfacePlan = {
    volume: true,
    wash: quality !== 'low',
    coreShadow: quality !== 'low',
    fillLight: quality !== 'low',
    edgeShade: quality !== 'low',
    cavity: quality === 'medium' || quality === 'high' || quality === 'ultra',
    rim: true,
    sheen: quality === 'high' || quality === 'ultra',
    specular: quality !== 'low' && material.specularStrength > 0.02,
    // The turbulence bands are off at every quality, measured, not assumed.
    // On the acceptance gallery (64 cells, the same oracle that measures the
    // reference image) the band stack cost 0.13 saturation and 15 points of
    // tonal range while adding 0.04 texture: flat grey paint blended over a
    // composited body pulls every channel towards the grey, and the texture
    // the material needs comes from the plush finish and the ramp dither.
    // The ladder and the filter emitters stay so a future material can opt
    // back in with a tone that has been measured to pay for itself.
    macro: false,
    micro: false,
    grain: false,
    fiber: false,
    layerCount: 0,
  }

  plan.layerCount =
    1 +
    (plan.volume ? 1 : 0) +
    (plan.wash ? 1 : 0) +
    (plan.coreShadow ? 1 : 0) +
    (plan.fillLight ? 1 : 0) +
    (plan.edgeShade ? 1 : 0) +
    (plan.cavity ? 1 : 0) +
    (plan.rim ? 1 : 0) +
    (plan.sheen ? 1 : 0) +
    (plan.specular ? 1 : 0) +
    (plan.macro ? 1 : 0) +
    (plan.micro ? 1 : 0) +
    (plan.grain ? 1 : 0) +
    (plan.fiber ? 1 : 0)

  return plan
}

/**
 * Builds the active noise bands. `seed` is forwarded to `feTurbulence`, which
 * keeps the grain identical between the preview, the export and a later PNG
 * rasterization.
 */
export const buildSurfaceNoiseLayers = (
  material: BlobMaterialDefinition,
  seed: number,
  plan: BlobSurfacePlan,
  idPrefix: string
): SurfaceNoiseLayer[] => {
  const layers: SurfaceNoiseLayer[] = []
  const safeSeed = ((Math.abs(Math.trunc(seed)) % 9973) + 9973) % 9973

  if (plan.macro && material.macroNoise > 0.01) {
    layers.push({
      kind: 'macro',
      filterId: `${idPrefix}-macro`,
      // Stronger macro noise means larger, slower undulations.
      baseFrequency: lerp(0.028, 0.008, clamp01(material.macroNoise)).toFixed(4),
      numOctaves: 2,
      turbulenceType: 'fractalNoise',
      seed: safeSeed,
      // Disabled in `resolveSurfacePlan` (measured harmful). 0.5 is the
      // identity grey for soft-light, so an accidental re-enable is a no-op
      // instead of the shadow-lifting wash tone 0.62 used to be.
      tone: 0.5,
      opacity: clamp01(material.macroNoise * 0.85),
      blend: 'soft-light',
    })
  }

  if (plan.micro && material.microNoise > 0.01) {
    layers.push({
      kind: 'micro',
      filterId: `${idPrefix}-micro`,
      baseFrequency: lerp(0.52, 0.95, clamp01(material.microNoise)).toFixed(4),
      numOctaves: 2,
      turbulenceType: 'fractalNoise',
      seed: (safeSeed + 137) % 9973,
      // Disabled in `resolveSurfacePlan`; 0.5 keeps the band inert if it is
      // ever re-enabled.
      tone: 0.5,
      opacity: clamp01(material.microNoise * 0.95),
      blend: 'overlay',
    })
  }

  if (plan.grain && material.grain > 0.01) {
    layers.push({
      kind: 'grain',
      filterId: `${idPrefix}-grain`,
      baseFrequency: '0.9',
      numOctaves: 1,
      turbulenceType: 'turbulence',
      seed: (safeSeed + 411) % 9973,
      // Disabled in `resolveSurfacePlan`; 0.5 keeps the band inert.
      tone: 0.5,
      opacity: clamp01(material.grain * 0.55),
      blend: 'overlay',
    })
  }

  if (plan.fiber && material.fiber > 0.01) {
    layers.push({
      kind: 'fiber',
      filterId: `${idPrefix}-fiber`,
      // Anisotropic turbulence: a vertical texture stretched into fibre strands.
      baseFrequency: `${lerp(0.06, 0.016, clamp01(material.fiber)).toFixed(4)} ${lerp(0.3, 0.12, clamp01(material.fiber)).toFixed(4)}`,
      numOctaves: 3,
      turbulenceType: 'turbulence',
      seed: (safeSeed + 733) % 9973,
      // Disabled in `resolveSurfacePlan`; 0.5 keeps the band inert.
      tone: 0.5,
      opacity: clamp01(material.fiber * 0.75),
      blend: 'overlay',
    })
  }

  return layers
}
