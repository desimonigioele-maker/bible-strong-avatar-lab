/**
 * Colour fields (FASI 9, 10, 56).
 *
 * A single `blue -> darkBlue` ramp is the flattest possible reading of a dot.
 * The reference look comes from several overlapping tinted spots: the base
 * hue, a cooler lift where the key lands, a violet or indigo body, a slightly
 * white highlight and a deeper blue in the shadow.
 *
 * Each spot is a camera-anchored radial layer, clipped to the silhouette and
 * resolved in OKLab, so the overlaps read as one material rather than as a
 * gradient. The palette is derived from the material, never hard-coded, and
 * the spot count is a parameter so a matte material can use fewer.
 */

import { mixColors, shiftColor } from './blobColor'
import { clamp01 } from './blobUtils'
import type { BlobMaterialDefinition } from './blobMaterial'

export type ColorField = {
  /** Screen position in user space; fixed in camera space, never in the object. */
  cx: number
  cy: number
  radius: number
  color: string
  opacity: number
  /**
   * Blend mode. The colour fields are additive tints over the lit body, so
   * `screen` lifts and `multiply` deepens without ever clipping to black.
   */
  blend: 'screen' | 'multiply' | 'soft-light'
}

/**
 * Spot recipes, in the order they are painted.
 *
 * The hues are expressed as OKLCH offsets from the base rather than as fixed
 * colours, so a yellow dot gets a warm field and a blue dot a cool one from
 * the same recipe.
 */
const SPOT_RECIPES = [
  { keyLift: 0.9, tint: { lightness: 0.16, chroma: 0.9, hue: -18 }, blend: 'screen', spread: 1.15 },
  {
    keyLift: 0.62,
    tint: { lightness: 0.06, chroma: 1.1, hue: 26 },
    blend: 'soft-light',
    spread: 1.5,
  },
  {
    keyLift: 0.1,
    tint: { lightness: -0.1, chroma: 1.05, hue: 14 },
    blend: 'soft-light',
    spread: 1.8,
  },
  {
    keyLift: -0.72,
    tint: { lightness: -0.26, chroma: 1.15, hue: -8 },
    blend: 'multiply',
    spread: 1.35,
  },
  {
    keyLift: -0.4,
    tint: { lightness: -0.12, chroma: 1.2, hue: 40 },
    blend: 'soft-light',
    spread: 1.05,
  },
] as const

/**
 * Builds the colour fields for a material.
 *
 * The spots are placed along the key light axis so the tint always agrees with
 * the lighting: the cool lift lands where the key is, the deepen falls on the
 * opposite side. Placing them independently is what produces the "gradient
 * sticker" look the prompt calls out.
 */
export const buildColorFields = (input: {
  material: BlobMaterialDefinition
  /** Key light azimuth in radians, in camera space. */
  azimuth: number
  centerX: number
  centerY: number
  radius: number
  /** Direction the key light travels from: the lit side. */
  axisX: number
  axisY: number
  count: number
  intensity: number
}): ColorField[] => {
  const base = input.material.palette.base
  const fields: ColorField[] = []
  const count = Math.max(1, Math.min(SPOT_RECIPES.length, Math.round(input.count)))

  for (let index = 0; index < count; index++) {
    const recipe = SPOT_RECIPES[index]
    // Each spot is pushed out along the light axis by its own lift, so the
    // fields nest rather than stacking on one point.
    const distance = input.radius * 0.62 * recipe.keyLift
    const color = shiftColor(base, recipe.tint)
    fields.push({
      cx: input.centerX + input.axisX * distance,
      cy: input.centerY + input.axisY * distance,
      radius: input.radius * recipe.spread,
      color,
      // The spots are tints, not a second lighting model. Kept low on purpose:
      // stacked `screen` and `soft-light` layers are the fastest way to turn a
      // modelled ramp back into the flat wash this renderer is meant to avoid.
      // Measured on the composited acceptance gallery, this stack alone cost
      // ~12 points of tonal range at the old budget, so the whole ladder is
      // scaled down a quarter.
      opacity: clamp01(input.intensity * (0.085 - index * 0.013)),
      blend: recipe.blend,
    })
  }

  return fields
}

/**
 * The colour of the body at its most neutral point: the base hue lifted just
 * enough to stay alive, used as the fill under every field.
 */
export const baseBodyColor = (material: BlobMaterialDefinition): string =>
  mixColors(material.palette.shadow, material.palette.base, 0.72)

/**
 * Tint of the broad highlight, resolved in OKLab so a white spot over a blue
 * body reads as a lit material instead of a pasted white ellipse (FASI 58).
 */
export const highlightTint = (material: BlobMaterialDefinition): string =>
  mixColors(material.palette.highlight, '#ffffff', 0.45)
