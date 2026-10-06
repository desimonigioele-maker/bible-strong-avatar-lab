/**
 * The measurement oracle, measured (FASE A).
 *
 * Every quality decision on this renderer now hangs off these three numbers,
 * so the numbers themselves are the most dangerous thing in the lab: a metric
 * that quietly averages the background in, or that counts an antialiased edge
 * as texture, would send every later tuning step in the wrong direction while
 * looking perfectly plausible.
 *
 * These are synthetic images with known answers, not snapshots.
 */
import { describe, expect, it } from 'vitest'

import {
  measurePixels,
  measureScriptSource,
  referenceTargets,
  summarize,
  verdictOf,
} from '../dotLabMetrics'

/** Builds RGBA data from a function of (x, y). */
const image = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number]
): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y)
      const offset = (y * width + x) * 4
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = a
    }
  }
  return data
}

describe('measurePixels', () => {
  it('reports a uniform opaque field as featureless: no range, no texture', () => {
    const metrics = measurePixels(
      image(16, 16, () => [90, 140, 200, 255]),
      16,
      16
    )
    expect(metrics.samples).toBe(256)
    expect(metrics.range).toBe(0)
    expect(metrics.texture).toBe(0)
    expect(metrics.saturation).toBeCloseTo((200 - 90) / 200, 5)
  })

  it('ignores the background entirely, so a dot on a black page cannot claim its contrast', () => {
    // Half the pixels are the page (alpha 0) at a wildly different luminance.
    const mixed = image(16, 16, x => (x < 8 ? [255, 255, 255, 0] : [100, 100, 100, 255]))
    const metrics = measurePixels(mixed, 16, 16)
    expect(metrics.samples).toBe(128)
    // If the background leaked in, range would be 255 rather than 0.
    expect(metrics.range).toBe(0)
  })

  it('measures p95-p05 of luminance, not the full min-max', () => {
    // A column of outliers: one pixel per row far from the rest. Min-max would
    // report the outlier; p05-p95 must not.
    const data = image(32, 32, x => (x === 0 ? [255, 255, 255, 255] : [120, 120, 120, 255]))
    const metrics = measurePixels(data, 32, 32)
    expect(metrics.range).toBeLessThan(1)
  })

  it('reads a stepped gradient as having the tonal range it actually has', () => {
    const data = image(32, 32, x => {
      const value = x < 16 ? 30 : 220
      return [value, value, value, 255]
    })
    const metrics = measurePixels(data, 32, 32)
    expect(metrics.range).toBeCloseTo(190, 0)
    // Neutral grey carries no chroma, so saturation must be zero-valued rather
    // than undefined: colouredRatio is what says "nothing to measure here".
    expect(metrics.coloredRatio).toBe(0)
    expect(metrics.saturation).toBe(0)
  })

  it('counts grain as texture and a flat body as none', () => {
    const flat = measurePixels(
      image(32, 32, () => [128, 128, 128, 255]),
      32,
      32
    )
    expect(flat.texture).toBe(0)

    const grain = measurePixels(
      image(32, 32, (x, y) => {
        // Deterministic high-frequency noise: ±40 around mid grey.
        const offset = ((x * 7 + y * 13) % 3) * 40 - 40
        return [128 + offset, 128 + offset, 128 + offset, 255]
      }),
      32,
      32
    )
    expect(grain.texture).toBeGreaterThan(10)
  })

  it('does not let the silhouette edge dominate the texture score', () => {
    // One antialiased boundary, otherwise perfectly flat. If edges counted,
    // every shape in the grid would score "textured" for being a shape.
    const edged = image(32, 32, (x, y) => {
      const inside = Math.hypot(x - 16, y - 16) < 12
      const edge = Math.abs(Math.hypot(x - 16, y - 16) - 12) < 1
      if (edge) return [160, 160, 160, 255]
      return inside ? [140, 140, 140, 255] : [140, 140, 140, 255]
    })
    expect(measurePixels(edged, 32, 32).texture).toBeLessThan(5)
  })
})

describe('measureScriptSource', () => {
  it('evaluates to exactly what the module computes', () => {
    // The static gallery cannot import this module, so it runs a stringified
    // copy of the arithmetic. If the two ever disagree, every number in the
    // committed evidence file is silently wrong and looks fine - which is why
    // they are compared on real data rather than trusted.
    const data = image(24, 24, (x, y) => {
      const base = 40 + ((x * 5 + y * 3) % 10) * 18
      return [base, base + 30, base + 90, x < 2 && y < 2 ? 0 : 255]
    })
    const inModule = measurePixels(data, 24, 24)

    const factory = new Function(
      `${measureScriptSource}\nreturn measurePixels;`
    ) as () => typeof measurePixels
    const inScript = factory()(data, 24, 24)

    expect(inScript).toEqual(inModule)
  })

  it('declares nothing that would collide with the gallery page', () => {
    // The source is evaluated in the global scope of a plain HTML file, so it
    // must define its helpers itself and reference only locals.
    expect(measureScriptSource).toContain('const luminance =')
    expect(measureScriptSource).toContain('const percentile =')
    expect(measureScriptSource).toContain('const measurePixels =')
    expect(measureScriptSource).not.toContain(': number')
    expect(measureScriptSource).not.toContain(': ArrayLike')
  })
})

describe('summarize and verdicts', () => {
  const metric = (saturation: number, range: number, texture: number) => ({
    saturation,
    range,
    texture,
    coloredRatio: 1,
    samples: 100,
  })

  it('averages each metric independently across cells', () => {
    const summary = summarize([metric(0.8, 120, 5), metric(0.4, 80, 3)])
    expect(summary.saturation).toBeCloseTo(0.6, 5)
    expect(summary.range).toBeCloseTo(100, 5)
    expect(summary.texture).toBeCloseTo(4, 5)
    expect(summary.cells).toBe(2)
  })

  it('summarises an empty set to zeroes instead of NaN', () => {
    const summary = summarize([])
    expect(summary.cells).toBe(0)
    expect(summary.saturation).toBe(0)
    expect(Number.isFinite(summary.range)).toBe(true)
  })

  it('grades each metric against its own threshold', () => {
    const pass = verdictOf(metric(0.7, 110, 4))
    expect(pass).toEqual({ saturation: true, range: true, texture: true })

    const fail = verdictOf(metric(0.3, 60, 1.6))
    expect(fail).toEqual({ saturation: false, range: false, texture: false })

    // Partial: the field renderer's signature failure is range and texture
    // while saturation is already borderline.
    expect(verdictOf(metric(0.66, 60, 1.6))).toEqual({
      saturation: true,
      range: false,
      texture: false,
    })
  })

  it('keeps the reference thresholds themselves inside what the artwork measured', () => {
    // If someone loosens the targets until the current renderer passes, this
    // fails. The thresholds are derived from the reference, not from us.
    expect(referenceTargets.saturation).toBeGreaterThan(0.6)
    expect(referenceTargets.range).toBeGreaterThan(90)
    expect(referenceTargets.texture).toBeGreaterThan(3)
  })
})
