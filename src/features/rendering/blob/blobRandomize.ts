/**
 * Randomize with locks (FASI 40).
 *
 * "Randomize everything" is only useful if it leaves alone what the author
 * decided on. A studio portrait keeps its face and gets a new outfit; a
 * silhouette study keeps its shape and gets a new material. Locks encode that
 * intent explicitly instead of guessing it.
 *
 * Every draw comes from the config's own seed, so a variant is reproducible:
 * the same seed and the same locks always produce the same dot, and the seed
 * is readable in the inspector.
 */

import { blobMaterialPresets } from './blobPresets'
import { blobShapeFamilyList, blobShapePresets } from './blobGeometry'
import { normalizeSeed } from './blobUtils'
import { createDefaultBlobConfig, type BlobConfig, type BlobShapeFamily } from './blobTypes'
import { normalizeBlobConfig } from './blobConfig'

export const randomizeGroups = ['shape', 'material', 'light', 'motion'] as const
export type RandomizeGroup = (typeof randomizeGroups)[number]

export type RandomizeLocks = Record<RandomizeGroup, boolean>

export const allLocks = (locked: boolean): RandomizeLocks => ({
  shape: locked,
  material: locked,
  light: locked,
  motion: locked,
})

/** Draws a bounded integer from a seeded stream. */
const pick = (random: () => number, count: number): number =>
  Math.min(count - 1, Math.max(0, Math.floor(random() * count)))

/**
 * Advances the seed.
 *
 * The seed is a document field, so it has to move with the draw: a user who
 * hits randomize twice must not get the same result, and a user who shares the
 * seed must get the same one back.
 */
const nextSeed = (seed: number, random: () => number): number => {
  const candidate = Math.floor(random() * 2147483000)
  // A draw that lands on the current seed would look like the button did
  // nothing, so it is nudged rather than retried.
  return candidate === seed ? (seed + 1) % 2147483000 : candidate
}

const randomizeShape = (config: BlobConfig, seed: number): Pick<BlobConfig, 'shape'> => {
  const random = mulberry(seed)
  const family = blobShapeFamilyList[pick(random, blobShapeFamilyList.length)]
  const preset = blobShapePresets[family]
  return {
    shape: {
      ...preset,
      family,
      seed,
      // Radius and elongation stay inside the family preset on purpose: a
      // random size would make the same shape look like a different one.
      radius: preset.radius * (0.92 + random() * 0.16),
    },
  }
}

const randomizeMaterial = (config: BlobConfig, seed: number): Pick<BlobConfig, 'material'> => {
  const random = mulberry(seed)
  const preset = blobMaterialPresets[pick(random, blobMaterialPresets.length)]
  return { material: { ...preset.material } }
}

const randomizeLight = (seed: number): Pick<BlobConfig, 'lighting'> => {
  const random = mulberry(seed)
  // The key stays in the upper half: a light from below reads as an
  // interrogation lamp, and a variant should never look like a mistake.
  const angle = -Math.PI * (0.15 + random() * 0.7)
  const distance = 0.55 + random() * 0.4
  return {
    lighting: {
      ...createDefaultBlobConfig().lighting,
      lightX: Math.cos(angle) * distance,
      lightY: Math.sin(angle) * distance,
      lightZ: 0.55 + random() * 0.35,
      intensity: 0.78 + random() * 0.28,
      ambient: 0.26 + random() * 0.16,
      fillIntensity: 0.22 + random() * 0.24,
      softness: 0.45 + random() * 0.4,
    },
  }
}

const randomizeMotion = (seed: number): Pick<BlobConfig, 'motion'> => {
  const random = mulberry(seed)
  // Amplitudes stay inside the subliminal band from FASI 29-30. A randomizer
  // that can produce a bouncing balloon is not a randomizer, it is a bug.
  return {
    motion: {
      ...createDefaultBlobConfig().motion,
      breathing: 0.012 + random() * 0.012,
      float: 0.006 + random() * 0.012,
      rotation: 0.4 + random() * 1.4,
      surfaceDrift: 0.04 + random() * 0.12,
    },
  }
}

/** Mulberry32, kept local so this module has no dependency on the blob utils. */
const mulberry = (seed: number): (() => number) => {
  let state = normalizeSeed(seed)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Applies the randomize.
 *
 * `groups` selects what is redrawn; anything not listed is preserved exactly,
 * which is what makes "randomize material only" a one-liner.
 */
export const randomizeBlobConfig = (
  config: BlobConfig,
  groups: readonly RandomizeGroup[],
  seed: number
): BlobConfig => {
  const base = normalizeBlobConfig(config)
  const wanted = new Set(groups)
  const next = { ...base }
  const draw = (offset: number) => normalizeSeed(seed + offset * 7919)

  if (wanted.has('shape')) Object.assign(next, randomizeShape(base, draw(1)))
  if (wanted.has('material')) Object.assign(next, randomizeMaterial(base, draw(2)))
  if (wanted.has('light')) Object.assign(next, randomizeLight(draw(3)))
  if (wanted.has('motion')) Object.assign(next, randomizeMotion(draw(4)))

  return normalizeBlobConfig({
    ...next,
    // The seed always moves, so a second press gives a different result even
    // when every group is locked.
    shape: { ...next.shape, seed: nextSeed(base.shape.seed, mulberry(draw(5))) },
  })
}

/** The groups a "randomize all" press would redraw, given the locks. */
export const unlockedGroups = (locks: RandomizeLocks): RandomizeGroup[] =>
  randomizeGroups.filter(group => !locks[group])

/** Convenience: the shape families a user can lock onto. */
export const randomizableShapeFamilies: BlobShapeFamily[] = blobShapeFamilyList
