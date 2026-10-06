import { describe, expect, it } from 'vitest'

import {
  applyBlobShapeFamily,
  blobShapeFamilyList,
  blobShapePresets,
  buildBlobGeometry,
  buildBlobInsetPath,
} from '../blobGeometry'
import { normalizeBlobConfig } from '../blobConfig'
import { createDefaultBlobConfig } from '../blobTypes'

const shapeOf = (overrides: Record<string, unknown> = {}) =>
  normalizeBlobConfig({ shape: { ...createDefaultBlobConfig().shape, ...overrides } }).shape

describe('silhouette determinism', () => {
  it('gives the same outline for the same seed', () => {
    expect(buildBlobGeometry(shapeOf({ seed: 918273 })).path).toBe(
      buildBlobGeometry(shapeOf({ seed: 918273 })).path
    )
  })

  it('gives a different outline for a different seed', () => {
    expect(buildBlobGeometry(shapeOf({ seed: 1 })).path).not.toBe(
      buildBlobGeometry(shapeOf({ seed: 2 })).path
    )
  })

  it('survives seed 0 and a negative seed', () => {
    expect(buildBlobGeometry(shapeOf({ seed: 0 })).path).not.toContain('NaN')
    expect(buildBlobGeometry(shapeOf({ seed: -999 })).path).not.toContain('NaN')
  })
})

describe('silhouette structure', () => {
  it('samples the requested number of points', () => {
    expect(buildBlobGeometry(shapeOf({ pointCount: 64 })).points).toHaveLength(64)
    expect(buildBlobGeometry(shapeOf({ pointCount: 128 })).points).toHaveLength(128)
  })

  it('emits one cubic segment per point and closes the path', () => {
    const geometry = buildBlobGeometry(shapeOf({ pointCount: 48 }))
    expect(geometry.path.split('C').length - 1).toBe(48)
    expect(geometry.path.endsWith(' Z')).toBe(true)
  })

  it('produces finite coordinates at every extreme', () => {
    const extremes = [
      { pointCount: 12, radius: 8 },
      { pointCount: 512, radius: 400 },
      { irregularity: 0, asymmetry: 0, lobeStrength: 0, deformationAmplitude: 0 },
      { irregularity: 1, asymmetry: 1, lobeStrength: 1, deformationAmplitude: 1 },
      { elongationX: 0.2, elongationY: 3 },
      { elongationX: 3, elongationY: 0.2 },
      { lobeCount: 0 },
      { lobeCount: 24 },
      { smoothness: 0 },
      { smoothness: 1 },
    ]
    for (const overrides of extremes) {
      const geometry = buildBlobGeometry(shapeOf(overrides))
      expect(geometry.path).not.toContain('NaN')
      expect(geometry.path).not.toContain('Infinity')
      expect(Number.isFinite(geometry.center.x)).toBe(true)
      expect(Number.isFinite(geometry.center.y)).toBe(true)
      expect(geometry.bounds.width).toBeGreaterThan(0)
      expect(geometry.bounds.height).toBeGreaterThan(0)
    }
  })

  it('keeps a smooth outline at every smoothness value', () => {
    // Degenerate smoothness collapses the curve onto its chords; the path must
    // still be a valid, non-empty curve.
    for (const smoothness of [0, 0.5, 1]) {
      const geometry = buildBlobGeometry(shapeOf({ pointCount: 48, smoothness }))
      expect(geometry.path.startsWith('M ')).toBe(true)
      expect(geometry.path.split('C').length - 1).toBe(48)
    }
  })

  it('normalizes the outline to the configured radius', () => {
    const geometry = buildBlobGeometry(shapeOf({ radius: 100 }))
    const mean =
      geometry.points.reduce((total, point) => total + Math.hypot(point.x, point.y), 0) /
      geometry.points.length
    expect(mean).toBeCloseTo(100, 0)
  })

  it('rotates the outline without changing its size', () => {
    const upright = buildBlobGeometry(shapeOf({ rotation: 0 }))
    const turned = buildBlobGeometry(shapeOf({ rotation: 90 }))
    const span = (geometry: { bounds: { width: number; height: number } }) =>
      Math.max(geometry.bounds.width, geometry.bounds.height)
    expect(span(turned)).toBeCloseTo(span(upright), 0)
  })
})

describe('shape families', () => {
  it('gives every family a distinct outline', () => {
    const paths = blobShapeFamilyList.map(
      family => buildBlobGeometry(blobShapePresets[family]).path
    )
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('keeps the current seed when switching family', () => {
    const config = {
      ...createDefaultBlobConfig(),
      shape: { ...createDefaultBlobConfig().shape, seed: 31337 },
    }
    expect(applyBlobShapeFamily(config, 'bean').shape.seed).toBe(31337)
    expect(applyBlobShapeFamily(config, 'bean').shape.family).toBe('bean')
  })
})

describe('inset outline', () => {
  it('shrinks toward the centre', () => {
    const geometry = buildBlobGeometry(shapeOf({ pointCount: 48 }))
    const inset = buildBlobInsetPath(geometry, 0.5)
    expect(inset).not.toContain('NaN')
    expect(inset.split('C').length - 1).toBe(48)
    expect(inset).not.toBe(geometry.path)
  })
})
