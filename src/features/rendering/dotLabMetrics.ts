/**
 * Measurement oracle for the DOT MATERIAL LAB (FASE A).
 *
 * Every quality judgement on this renderer has so far been made by eye, and by
 * eye it was wrong twice: the first "obvious" bug was not there, and the real
 * one - a body flatter than a plain radial gradient - was invisible until a
 * canvas measured it. These functions are the oracle: same numbers, same code,
 * for the reference image, the studio preview and the exported SVG.
 *
 * The three metrics are deliberately cheap and deliberately *different*:
 *
 *   - `saturation` catches the ramp desaturating through sRGB mixing and the
 *     additive layers washing the chroma out;
 *   - `range` catches the composited body collapsing towards one value, which
 *     is what a stack of `screen` and `soft-light` layers does;
 *   - `texture` catches a material losing its grain, which no amount of
 *     contrast can hide.
 *
 * Pure pixel arithmetic only: no DOM, no canvas, no React. The caller owns the
 * rasterization so the studio, the tests and a future batch renderer can all
 * measure the same way.
 */

/** Result of measuring one rasterized dot. */
export type DotMetrics = {
  /** Mean saturation of the *coloured* pixels: (max-min)/max. 0..1. */
  saturation: number
  /** p95 - p05 of luminance across every opaque pixel. 0..255. */
  range: number
  /** Mean absolute difference to the left and upper neighbour. 0..255. */
  texture: number
  /** Share of opaque pixels that carry chroma. 0..1. */
  coloredRatio: number
  /** Opaque pixels that went into the statistics. */
  samples: number
}

export type DotMetricsSummary = DotMetrics & { cells: number }

/**
 * Thresholds, and where they came from.
 *
 * The reference is the plush artwork measured at the same resolution with the
 * same functions (see `docs/blob-rendering.md`): coloured-pixel saturation
 * p50 = 0.67..0.96 across the four characters, coloured luminance range 94.5,
 * texture energy 4.4..5.6. The flat control - one radial gradient, the
 * cheapest possible dot - measures range 121 and saturation 0.46.
 *
 * So a renderer that wants the reference's quality has to beat the flat
 * control on range *and* clear the reference on saturation and texture. The
 * thresholds sit slightly inside those numbers so they are reachable without
 * pushing the material into sticker territory.
 */
export const referenceTargets = {
  saturation: 0.65,
  range: 100,
  texture: 3.5,
} as const

/**
 * Below this palette chroma a material is neutral and is *not* scored on
 * saturation — the rule the metric's own colour test already documents ("a
 * neutral material like milk is compared on range and texture only rather
 * than being handed a saturation score for being grey").
 *
 * The reference artwork is four chromatic characters, so its 0.67-0.96
 * saturation medians are a comparison between like things; averaging grey
 * materials into that score would measure the material list, not the
 * renderer. Range and texture are still measured on every cell.
 */
export const neutralMaterialChroma = 0.08

/** The measurements the thresholds were derived from, kept for the record. */
export const referenceEvidence = {
  /** Reference artwork, coloured pixels, median saturation per character. */
  referenceSaturation: [0.964, 0.673, 0.798, 0.843],
  /** Reference artwork, coloured pixels, p95-p05 luminance. */
  referenceRange: 94.5,
  /** Reference artwork, high-frequency energy per character. */
  referenceTexture: [4.51, 4.44, 5.6, 4.55],
  /** Cheapest possible control: one radial gradient over the base colour. */
  flatControlSaturation: 0.457,
  flatControlRange: 121.5,
} as const

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[index]
}

/**
 * Measures one rasterized dot.
 *
 * `pixels` is RGBA data in row-major order. Pixels with alpha below 250 are
 * background and are excluded from every statistic: a dot rendered on a black
 * page would otherwise report the page's contrast as its own.
 *
 * The colour test (`max > 40 && max-min >= 12`) matches the one used on the
 * reference image, so a neutral material like `milk` is compared on range and
 * texture only rather than being handed a saturation score for being grey.
 */
export const measurePixels = (
  pixels: ArrayLike<number>,
  width: number,
  height: number
): DotMetrics => {
  const luminances: number[] = []
  let saturationTotal = 0
  let colored = 0

  for (let index = 0; index < width * height; index++) {
    const offset = index * 4
    const r = pixels[offset]
    const g = pixels[offset + 1]
    const b = pixels[offset + 2]
    const alpha = pixels[offset + 3]
    if (alpha < 250) continue

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    luminances.push(luminance(r, g, b))

    if (max > 40 && max - min >= 12) {
      saturationTotal += max === 0 ? 0 : (max - min) / max
      colored += 1
    }
  }

  luminances.sort((left, right) => left - right)

  // Texture is measured against the upper and left neighbour only, so the
  // silhouette transition does not dominate: an antialiased edge would
  // otherwise read as "textured" for every shape in the grid.
  let textureTotal = 0
  let textureSamples = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const offset = (y * width + x) * 4
      if (pixels[offset + 3] < 250) continue
      const here = luminance(pixels[offset], pixels[offset + 1], pixels[offset + 2])
      const left = luminance(pixels[offset - 4], pixels[offset - 3], pixels[offset - 2])
      const above = luminance(
        pixels[offset - width * 4],
        pixels[offset - width * 4 + 1],
        pixels[offset - width * 4 + 2]
      )
      textureTotal += (Math.abs(here - left) + Math.abs(here - above)) / 2
      textureSamples += 1
    }
  }

  const samples = luminances.length
  return {
    saturation: colored === 0 ? 0 : saturationTotal / colored,
    range: samples === 0 ? 0 : percentile(luminances, 0.95) - percentile(luminances, 0.05),
    texture: textureSamples === 0 ? 0 : textureTotal / textureSamples,
    coloredRatio: samples === 0 ? 0 : colored / samples,
    samples,
  }
}

/**
 * Mean of every metric across a set of cells; an empty set summarises to
 * zeroes so a caller can render a stable shape instead of branching.
 */
export const summarize = (metrics: DotMetrics[]): DotMetricsSummary => {
  if (metrics.length === 0) {
    return { saturation: 0, range: 0, texture: 0, coloredRatio: 0, samples: 0, cells: 0 }
  }
  let saturation = 0
  let range = 0
  let texture = 0
  let coloredRatio = 0
  for (const metric of metrics) {
    saturation += metric.saturation
    range += metric.range
    texture += metric.texture
    coloredRatio += metric.coloredRatio
  }
  const count = metrics.length
  return {
    saturation: saturation / count,
    range: range / count,
    texture: texture / count,
    coloredRatio: coloredRatio / count,
    samples: 0,
    cells: count,
  }
}

/** Which of the three thresholds a measurement clears. */
export type MetricVerdict = { saturation: boolean; range: boolean; texture: boolean }

/** Anything carrying the three numbers: one cell or a whole renderer. */
export type Measurable = Pick<DotMetrics, 'saturation' | 'range' | 'texture'>

export const verdictOf = (summary: Measurable): MetricVerdict => ({
  saturation: summary.saturation >= referenceTargets.saturation,
  range: summary.range >= referenceTargets.range,
  texture: summary.texture >= referenceTargets.texture,
})

/** One decimal for ranges, three for ratios: readable without lying. */
export const formatMetrics = (summary: Measurable): string =>
  `sat ${summary.saturation.toFixed(3)} · rng ${summary.range.toFixed(1)} · tex ${summary.texture.toFixed(2)}`

/**
 * The same arithmetic, as source, for pages that cannot import TypeScript.
 *
 * The static gallery is a committed artefact: a single HTML file with no
 * build step, so it cannot `import` this module. Stringifying the functions
 * instead of copying their bodies is what keeps the two from drifting - a
 * hand-maintained copy of this algorithm would silently disagree with the
 * lab page the first time either was tuned, and the disagreement would be
 * invisible because both would still print plausible numbers.
 *
 * `dot-lab-metrics-test.ts` evaluates this source and compares it against the
 * real function, so a drift cannot reach a committed gallery.
 */
export const measureScriptSource = [
  `const luminance = ${luminance.toString()};`,
  `const percentile = ${percentile.toString()};`,
  `const measurePixels = ${measurePixels.toString()};`,
].join('\n')
