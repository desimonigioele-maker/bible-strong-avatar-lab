import { describe, expect, it } from 'vitest'

import { hexToOklch, hexToRgb, mixColors, mixOklab, oklchToHex, shiftColor } from '../blobColor'

const channels = (hex: string) => hexToRgb(hex)

const closeToColor = (actual: string, expected: string, tolerance = 1) => {
  const a = channels(actual)
  const b = channels(expected)
  expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(tolerance)
  expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(tolerance)
}

describe('OKLab color transform', () => {
  it('round-trips the shipped ramp colors through OKLCH', () => {
    for (const hex of ['#2f8cff', '#00196c', '#89daff', '#f5c33b', '#35c98a', '#b7c6ea']) {
      const roundTrip = oklchToHex(hexToOklch(hex))
      // Gamut fitting may shift a channel by a hair, never by a visible step.
      closeToColor(roundTrip, hex, 3)
    }
  })

  it('hits both endpoints exactly and clamps out-of-range amounts', () => {
    const from = '#2f8cff'
    const to = '#00196c'
    closeToColor(mixOklab(from, to, 0), from)
    closeToColor(mixOklab(from, to, 1), to)
    // Non-finite / out-of-range amounts must never leak NaN into the SVG.
    closeToColor(mixOklab(from, to, -4), mixOklab(from, to, 0))
    closeToColor(mixOklab(from, to, 9), mixOklab(from, to, 1))
    expect(mixOklab(from, to, Number.NaN)).not.toContain('NaN')
  })

  it('keeps more chroma than sRGB on cross-hue mixes (the interior detour)', () => {
    // Where the sRGB path walks through the cube's grey interior, the OKLab
    // chord stays chromatic. Measured on these pairs: blue→green keeps ~6.5%
    // more chroma, the aurora field pair ~5.5% (asserted with margin).
    // Same-hue blue stops mix nearly identically in both spaces and are pinned
    // by the ramp's saturation metric instead.
    const crossHuePairs: [string, string][] = [
      ['#2f8cff', '#35c98a'],
      ['#3f7de0', '#35c98a'],
    ]
    for (const [a, b] of crossHuePairs) {
      const oklab = hexToOklch(mixOklab(a, b, 0.5))
      const srgb = hexToOklch(mixColors(a, b, 0.5))
      expect(oklab.c).toBeGreaterThan(srgb.c * 1.04)
    }
  })

  it('is deterministic', () => {
    expect(mixOklab('#2f8cff', '#f5c33b', 0.37)).toBe(mixOklab('#2f8cff', '#f5c33b', 0.37))
  })

  it('shifts lightness and chroma along OKLCH without breaking the color', () => {
    const base = '#2f8cff'
    const darker = channels(shiftColor(base, { lightness: -0.25 }))
    const original = channels(base)
    expect(darker.r + darker.g + darker.b).toBeLessThan(original.r + original.g + original.b)

    const neutral = hexToOklch(shiftColor(base, { chroma: 0 }))
    expect(neutral.c).toBeLessThan(0.02)
    expect(shiftColor(base, { lightness: 0.1 })).not.toContain('NaN')
  })
})
