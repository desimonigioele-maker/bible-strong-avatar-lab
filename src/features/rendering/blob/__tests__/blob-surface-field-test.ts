/**
 * The Phase 6 fallback: a soft spherical surface in silhouette space.
 *
 * The field normally comes from tracing the limb with the fork's own
 * `projectSurfaceSample`, which is the right answer and is what every normal
 * avatar uses. These tests cover the other case — a surface too degenerate to
 * trace — because the failure mode is quiet rather than loud: the limb test
 * still returns thousands of points, so nothing looks broken, and every
 * downstream term divides by a silhouette that has collapsed to a line.
 */

import {
  poseFromExpression,
  surfacePresets,
  type Expression,
  type SurfaceConfig,
} from '@bible-strong/avatar-core'
import { describe, expect, it } from 'vitest'

import { buildSurfaceField } from '../blobSurfaceField'

const expression: Expression = {
  id: 'fallback',
  headX: 0,
  headY: 0,
  headZ: 0,
  widthLeft: 40,
  widthRight: 40,
  heightLeft: 40,
  heightRight: 40,
  spacing: 70,
  positionXLeft: 0,
  positionXRight: 0,
  positionYLeft: 0,
  positionYRight: 0,
  leftAngle: 0,
  rightAngle: 0,
  perspective: 0.06,
  eyeMotion: 'none',
  bodyMotion: 'none',
}

const field = (surface: SurfaceConfig) => buildSurfaceField(poseFromExpression(expression), surface)

const allFinite = (surface: SurfaceConfig) =>
  field(surface).samples.every(sample =>
    [
      sample.screen.x,
      sample.screen.y,
      sample.depth,
      sample.height,
      sample.edgeDistance,
      ...sample.normal,
    ].every(Number.isFinite)
  )

const normalsAreUnit = (surface: SurfaceConfig) =>
  field(surface).ring.filter(entry => Math.abs(Math.hypot(...entry.normal) - 1) > 1e-6)

describe('soft spherical fallback', () => {
  it('traces the real surface whenever it can, at full resolution', () => {
    const traced = field(surfacePresets.softDot)
    expect(traced.ring.length).toBeGreaterThan(500)
    expect(traced.samples.length).toBeGreaterThan(3000)
    expect(traced.radiusX).toBeCloseTo(125, 0)
    expect(traced.radiusY).toBeCloseTo(125, 0)
    expect(normalsAreUnit(surfacePresets.softDot)).toHaveLength(0)
  })

  it('follows the silhouette aspect rather than assuming a circle', () => {
    const wide = field({ ...surfacePresets.softDot, width: 400, height: 120, depth: 200 })
    expect(wide.radiusX).toBeCloseTo(200, 0)
    expect(wide.radiusY).toBeCloseTo(60, 0)
  })

  it('keeps the orientation when one dimension collapses', () => {
    // A collapsed width must collapse X and leave Y alone. Reading the wrong
    // axis here is invisible until something renders sideways.
    const noWidth = field({ ...surfacePresets.softDot, width: 0 })
    expect(noWidth.radiusX).toBeLessThanOrEqual(noWidth.radiusY * 0.01)
    expect(noWidth.radiusY).toBeCloseTo(125, 0)

    const noHeight = field({ ...surfacePresets.softDot, height: 0 })
    expect(noHeight.radiusY).toBeLessThanOrEqual(noHeight.radiusX * 0.01)
    expect(noHeight.radiusX).toBeCloseTo(125, 0)
  })

  it('falls back rather than trusting a limb that collapsed onto a line', () => {
    // The limb test returns ~2400 points for a degenerate surface, so the
    // fallback cannot be keyed on how many points came back.
    const collapsed = field({ ...surfacePresets.softDot, width: 0, height: 0, depth: 0 })
    expect(collapsed.ring.length).toBe(24)
    expect(collapsed.samples.length).toBeGreaterThan(0)
    expect(
      normalsAreUnit({ ...surfacePresets.softDot, width: 0, height: 0, depth: 0 })
    ).toHaveLength(0)
  })

  it('contains a malformed surface instead of propagating NaN into the path data', () => {
    // The export runtime feeds its raw payload straight in without a parse
    // step, so a single NaN in the JSON would otherwise reach the `d`
    // attribute and the avatar would silently vanish.
    expect(allFinite({ ...surfacePresets.softDot, width: Number.NaN })).toBe(true)
    expect(allFinite({ ...surfacePresets.softDot, depth: Number.NaN })).toBe(true)
    expect(allFinite({ ...surfacePresets.softDot, width: 0, height: 0 })).toBe(true)
  })
})
