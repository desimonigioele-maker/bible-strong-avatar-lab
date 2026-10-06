/**
 * Material presets as pure data (FASI 10, 31, 67).
 *
 * A preset never contains a component, a renderer or a React element: it only
 * says what the material is, so new materials can be added without touching
 * the renderer. Each preset changes the whole character of the surface -
 * roughness, sheen, fiber, specular and noise - not just the color.
 */

import type { BlobMaterialConfig, BlobShapeFamily } from './blobTypes'

export type BlobMaterialPreset = {
  id: string
  /** English label; the UI translates it through i18n. */
  label: string
  material: BlobMaterialConfig
}

const softDefaults = {
  roughness: 0.68,
  grain: 0.14,
  macroNoise: 0.34,
  microNoise: 0.16,
  fiber: 0.28,
  sheen: 0.24,
  specular: 0.28,
  colorVariation: 0.04,
  deformation: 0.05,
  colorSpots: 4,
}

const plushDefaults = {
  roughness: 0.86,
  grain: 0.2,
  macroNoise: 0.42,
  microNoise: 0.26,
  fiber: 0.72,
  sheen: 0.3,
  specular: 0.1,
  colorVariation: 0.03,
  deformation: 0.07,
  colorSpots: 5,
}

export const blobMaterialPresets: BlobMaterialPreset[] = [
  {
    id: 'soft-blue',
    label: 'Soft Blue',
    material: { type: 'soft', baseColor: '#2f8cff', ...softDefaults },
  },
  {
    id: 'soft-green',
    label: 'Soft Green',
    material: { type: 'soft', baseColor: '#35c98a', ...softDefaults },
  },
  {
    id: 'soft-yellow',
    label: 'Soft Yellow',
    material: { type: 'soft', baseColor: '#f5c33b', ...softDefaults },
  },
  {
    id: 'soft-pink',
    label: 'Soft Pink',
    // Deepened from #ff7ab8: the pale pink measured 0.49 saturation against a
    // 0.65 oracle floor (coloured-pixel (max-min)/max), i.e. visibly washed
    // next to the reference family. This keeps the hue, drops the lightness.
    // Explicit deep shadow: the deeper base compressed the ramp's luminance
    // span (OKLab L→Y is cubic), which cost 18 range points. A dark chromatic
    // shadow restores p05 without touching saturation.
    material: {
      type: 'soft',
      baseColor: '#ff40a9',
      shadowColor: '#3d0020',
      ...softDefaults,
    },
  },
  {
    id: 'soft-purple',
    label: 'Soft Purple',
    // Deepened from #8b6cff (measured 0.53): lavender read as haze, not as
    // material, against the reference band.
    material: {
      type: 'soft',
      baseColor: '#7d33ff',
      shadowColor: '#180038',
      ...softDefaults,
    },
  },
  {
    id: 'plush-blue',
    label: 'Plush Blue',
    // The plush profile injects measurable grey noise (fiber 1.5, grain 0.45),
    // so plush bases must sit deeper than soft ones to measure the same
    // saturation: #4c8dfb measured 0.60, this lands ~0.69.
    material: { type: 'plush', baseColor: '#3581ff', ...plushDefaults },
  },
  {
    id: 'plush-green',
    label: 'Plush Green',
    // Deepened from #57cf9a (measured 0.61): mint read as pastel air next to
    // the reference's plush green.
    material: {
      type: 'plush',
      baseColor: '#2bc98d',
      shadowColor: '#00301c',
      ...plushDefaults,
    },
  },
  {
    id: 'plush-yellow',
    label: 'Plush Yellow',
    // Golden amber instead of pale straw (#ffd166 measured 0.65 sat but only
    // 89.9 range — the lightest material in the lab).
    material: {
      type: 'plush',
      // #fab800 overshot into amber (0.924 saturation); golden yellow keeps
      // the family read while the explicit shadow carries the tonal range.
      baseColor: '#f8c430',
      shadowColor: '#4a3000',
      ...plushDefaults,
    },
  },
  {
    id: 'plush-pink',
    label: 'Plush Pink',
    // Marginal at 0.648; nudged just past the floor without changing character.
    material: {
      type: 'plush',
      baseColor: '#fc2899',
      shadowColor: '#33001c',
      ...plushDefaults,
    },
  },
  {
    id: 'clay',
    label: 'Clay',
    material: {
      type: 'clay',
      baseColor: '#d9713f',
      roughness: 0.8,
      grain: 0.26,
      macroNoise: 0.28,
      microNoise: 0.22,
      fiber: 0.18,
      sheen: 0.1,
      specular: 0.2,
      colorVariation: 0.05,
      deformation: 0.06,
      colorSpots: 3,
    },
  },
  {
    id: 'gel',
    label: 'Gel',
    material: {
      type: 'gel',
      baseColor: '#38d6d0',
      roughness: 0.22,
      grain: 0.06,
      macroNoise: 0.12,
      microNoise: 0.08,
      fiber: 0.04,
      sheen: 0.35,
      specular: 0.78,
      colorVariation: 0.02,
      deformation: 0.02,
      colorSpots: 3,
    },
  },
  {
    id: 'matte',
    label: 'Matte',
    material: {
      type: 'matte',
      baseColor: '#8d93a6',
      roughness: 0.95,
      grain: 0.3,
      macroNoise: 0.18,
      microNoise: 0.1,
      fiber: 0.12,
      sheen: 0.04,
      specular: 0.02,
      colorVariation: 0.03,
      deformation: 0.08,
      colorSpots: 2,
    },
  },
  {
    id: 'glass',
    label: 'Glass',
    material: {
      type: 'glass',
      baseColor: '#a9d8ff',
      roughness: 0.08,
      grain: 0.02,
      macroNoise: 0.06,
      microNoise: 0.04,
      fiber: 0,
      sheen: 0.5,
      specular: 1,
      colorVariation: 0.015,
      deformation: 0.015,
      colorSpots: 3,
    },
  },
  {
    id: 'pearl',
    label: 'Pearl',
    material: {
      type: 'pearl',
      baseColor: '#b7c6ea',
      // Nacre reads warm where it catches the light; the body stays cool.
      highlightColor: '#fff7ea',
      roughness: 0.34,
      grain: 0.12,
      macroNoise: 0.26,
      microNoise: 0.1,
      fiber: 0.14,
      sheen: 0.55,
      specular: 0.5,
      colorVariation: 0.045,
      deformation: 0.03,
      // Wide field count: pearl is defined by its overlapping tints.
      colorSpots: 5,
    },
  },
  {
    id: 'aurora',
    label: 'Aurora',
    material: {
      type: 'soft',
      // Aurora mixes five colour fields, which desaturates its base harder than
      // any other preset (measured 0.63); the base compensates.
      baseColor: '#2871e4',
      roughness: 0.6,
      grain: 0.12,
      macroNoise: 0.3,
      microNoise: 0.14,
      fiber: 0.2,
      sheen: 0.34,
      specular: 0.32,
      colorVariation: 0.05,
      deformation: 0.05,
      // The widest field count: aurora is defined by its overlapping hues.
      colorSpots: 5,
    },
  },
  {
    id: 'milk',
    label: 'Milk',
    material: {
      type: 'soft',
      baseColor: '#f6efe6',
      // Near-white bases derive a shallow shadow (83 range - the weakest cell
      // in the lab); an explicit warm-grey shadow restores the tonal span
      // while staying under the neutral-chroma threshold.
      shadowColor: '#5c5044',
      roughness: 0.74,
      grain: 0.1,
      macroNoise: 0.26,
      microNoise: 0.12,
      fiber: 0.24,
      sheen: 0.3,
      specular: 0.24,
      colorVariation: 0.025,
      deformation: 0.045,
      colorSpots: 3,
    },
  },
  {
    id: 'smooth',
    label: 'Smooth',
    material: {
      type: 'soft',
      baseColor: '#6f7b96',
      roughness: 0.42,
      grain: 0.04,
      macroNoise: 0.14,
      microNoise: 0.06,
      fiber: 0.08,
      sheen: 0.2,
      specular: 0.42,
      colorVariation: 0.02,
      deformation: 0.02,
      colorSpots: 3,
    },
  },
]

export const findBlobMaterialPreset = (id: string): BlobMaterialPreset | undefined =>
  blobMaterialPresets.find(preset => preset.id === id)

/**
 * Quick picks for the inspector: a silhouette paired with a material, so a new
 * blob looks designed before the user touches a single slider (FASI 49, 50).
 */
export type BlobStylePreset = {
  id: string
  label: string
  shape: BlobShapeFamily
  materialPresetId: string
  seed: number
}

export const blobStylePresets: BlobStylePreset[] = [
  { id: 'studio', label: 'Studio', shape: 'round', materialPresetId: 'soft-blue', seed: 918273 },
  {
    id: 'marshmallow',
    label: 'Marshmallow',
    shape: 'amoeba',
    materialPresetId: 'plush-pink',
    seed: 41207,
  },
  { id: 'pebble', label: 'Pebble', shape: 'bean', materialPresetId: 'clay', seed: 77341 },
  { id: 'puddle', label: 'Puddle', shape: 'puddle', materialPresetId: 'gel', seed: 20518 },
  {
    id: 'cushion',
    label: 'Cushion',
    shape: 'roundedSquare',
    materialPresetId: 'plush-yellow',
    seed: 63092,
  },
  { id: 'pearl', label: 'Pearl', shape: 'round', materialPresetId: 'glass', seed: 88104 },
  {
    id: 'twins',
    label: 'Twins',
    shape: 'doubleLobe',
    materialPresetId: 'soft-purple',
    seed: 35476,
  },
  { id: 'breeze', label: 'Breeze', shape: 'cloud', materialPresetId: 'matte', seed: 11729 },
]
