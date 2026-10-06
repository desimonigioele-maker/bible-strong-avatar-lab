import { describe, expect, it } from 'vitest'

import {
  clamp01,
  closedCatmullRomPath,
  fbm2D,
  format,
  mulberry32,
  normalizeSeed,
  smilePath,
  valueNoise2D,
} from '../blobUtils'

describe('seeded randomness', () => {
  it('produces the same sequence for the same seed', () => {
    const left = Array.from({ length: 8 }, mulberry32(4242))
    const right = Array.from({ length: 8 }, mulberry32(4242))
    expect(left).toEqual(right)
  })

  it('produces a different sequence for a different seed', () => {
    const left = mulberry32(1)
    const right = mulberry32(2)
    expect(left()).not.toBe(right())
  })

  it('keeps every draw inside the unit interval', () => {
    const random = mulberry32(0)
    for (let index = 0; index < 500; index++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('normalizes seeds to non-negative integers', () => {
    expect(normalizeSeed(0)).toBe(0)
    expect(normalizeSeed(-17)).toBeGreaterThanOrEqual(0)
    expect(normalizeSeed(12.9)).toBe(12)
    expect(normalizeSeed(Number.NaN)).toBe(0)
    expect(normalizeSeed(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('value noise', () => {
  it('is deterministic per coordinate and seed', () => {
    expect(valueNoise2D(1.5, 2.5, 99)).toBe(valueNoise2D(1.5, 2.5, 99))
  })

  it('differs when the seed changes', () => {
    expect(valueNoise2D(1.5, 2.5, 1)).not.toBe(valueNoise2D(1.5, 2.5, 2))
  })

  it('stays within 0..1 for both the base noise and fbm', () => {
    for (let x = -4; x <= 4; x += 0.37) {
      for (let y = -4; y <= 4; y += 0.41) {
        expect(valueNoise2D(x, y, 7)).toBeGreaterThanOrEqual(0)
        expect(valueNoise2D(x, y, 7)).toBeLessThanOrEqual(1)
        expect(fbm2D(x, y, 7, 3)).toBeGreaterThanOrEqual(0)
        expect(fbm2D(x, y, 7, 3)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is continuous: nearby samples never jump', () => {
    const step = 0.001
    for (let x = 0; x < 3; x += 0.3) {
      const delta = Math.abs(fbm2D(x, 1.2, 5) - fbm2D(x + step, 1.2, 5))
      expect(delta).toBeLessThan(0.05)
    }
  })
})

describe('formatting helpers', () => {
  it('never emits NaN, Infinity or negative zero', () => {
    expect(format(Number.NaN)).toBe('0')
    expect(format(Number.POSITIVE_INFINITY)).toBe('0')
    expect(format(-0)).toBe('0')
    expect(format(1.23456)).toBe('1.235')
  })

  it('clamps out-of-range values', () => {
    expect(clamp01(-2)).toBe(0)
    expect(clamp01(3)).toBe(1)
  })
})

describe('path builders', () => {
  it('emits a closed cubic path with no NaN', () => {
    const points = Array.from({ length: 12 }, (_, index) => {
      const angle = (index / 12) * Math.PI * 2
      return { x: Math.cos(angle) * 50, y: Math.sin(angle) * 50 }
    })
    const path = closedCatmullRomPath(points, 1)
    expect(path.startsWith('M ')).toBe(true)
    expect(path.endsWith(' Z')).toBe(true)
    expect(path).not.toContain('NaN')
    expect(path.split('C').length - 1).toBe(12)
  })

  it('refuses to build a curve from fewer than three points', () => {
    expect(closedCatmullRomPath([{ x: 0, y: 0 }])).toBe('')
    expect(
      closedCatmullRomPath([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ])
    ).toBe('')
  })

  it('builds a mouth arc that stays finite at the extremes', () => {
    expect(smilePath(0, 40, 30, 7)).not.toContain('NaN')
    expect(smilePath(0, 40, 30, -20)).not.toContain('NaN')
  })
})
