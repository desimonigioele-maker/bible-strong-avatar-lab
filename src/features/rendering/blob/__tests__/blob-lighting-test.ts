import { describe, expect, it } from 'vitest'

import {
  poseFromExpression,
  surfacePresets,
  type Expression,
  type SurfaceConfig,
} from '@bible-strong/avatar-core'

import { buildColorFields } from '../blobColorFields'
import { createBlobMaterial } from '../blobMaterial'
import {
  cavityTerm,
  createLightRig,
  shadeSurface,
  softDiffuse,
  softRim,
  softSheen,
  softSpecular,
  type Vec3,
} from '../blobLights'
import {
  buildSurfaceField,
  deformNormal,
  edgeDistanceAt,
  normalAtScreenPoint,
  sampleSurfaceVariation,
} from '../blobSurfaceField'

const expression = (overrides: Partial<Expression> = {}): Expression => ({
  id: 'test',
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
  ...overrides,
})

const surface = (overrides: Partial<SurfaceConfig> = {}): SurfaceConfig => ({
  ...surfacePresets.sphere,
  ...overrides,
})

const rig = () =>
  createLightRig({
    keyX: -0.42,
    keyY: -0.58,
    keyZ: 0.7,
    keyColor: '#ffffff',
    fillColor: '#88aaff',
    rimColor: '#cfe0ff',
    intensity: 0.92,
    fillIntensity: 0.34,
    rimIntensity: 0.42,
    ambient: 0.44,
    softness: 0.62,
  })

const finite = (value: number) => Number.isFinite(value)

describe('surface field', () => {
  it('projects a limb of finite points around the pole', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    // The limb is traced by sampling the whole sphere, so it carries far more
    // points than a fixed ring would.
    expect(field.horizon.length).toBeGreaterThan(64)
    for (const point of field.horizon) {
      expect(finite(point.x)).toBe(true)
      expect(finite(point.y)).toBe(true)
    }
    expect(field.radiusX).toBeGreaterThan(1)
    expect(field.radiusY).toBeGreaterThan(1)
  })

  it('samples the whole visible hemisphere', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    // Five interior steps per limb direction, neither end included.
    expect(field.samples.length).toBe(field.ring.length * 5)
    expect(field.samples.length).toBeGreaterThan(0)
    for (const sample of field.samples) {
      expect(finite(sample.height)).toBe(true)
      expect(sample.height).toBeGreaterThanOrEqual(0)
      expect(sample.height).toBeLessThanOrEqual(1)
      expect(finite(sample.edgeDistance)).toBe(true)
    }
  })

  it('traces the limb in screen angle order exactly once', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    for (let index = 1; index < field.ring.length; index++) {
      expect(field.ring[index].angle).toBeGreaterThanOrEqual(field.ring[index - 1].angle)
    }
  })

  it('is deterministic for the same pose and surface', () => {
    const pose = poseFromExpression(expression())
    const left = buildSurfaceField(pose, surface())
    const right = buildSurfaceField(pose, surface())
    expect(left.horizon).toEqual(right.horizon)
    expect(left.curvature).toBe(right.curvature)
  })

  it('points the pole normal at the camera and the horizon normal across', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    expect(normalAtScreenPoint(field, field.center)[2]).toBeCloseTo(1, 5)
    // On the horizon the surface is edge-on, so z collapses to nothing.
    const rim = normalAtScreenPoint(field, field.horizon[0])
    expect(Math.abs(rim[2])).toBeLessThan(0.35)
  })

  it('keeps every interpolated normal unit length and finite', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    for (let step = 0; step < 40; step++) {
      const angle = (step / 40) * Math.PI * 2
      for (const radius of [0.1, 0.4, 0.7, 0.95, 1.2]) {
        const point = {
          x: field.center.x + Math.cos(angle) * field.radiusX * radius,
          y: field.center.y + Math.sin(angle) * field.radiusY * radius,
        }
        const normal = normalAtScreenPoint(field, point)
        const length = Math.hypot(normal[0], normal[1], normal[2])
        expect(finite(normal[0]) && finite(normal[1]) && finite(normal[2])).toBe(true)
        expect(length).toBeGreaterThan(0.99)
        expect(length).toBeLessThan(1.01)
      }
    }
  })

  it('never produces NaN when the surface degenerates', () => {
    const degenerate = surface({ width: 0, height: 0, depth: 0 })
    const field = buildSurfaceField(poseFromExpression(expression()), degenerate)
    const normal = normalAtScreenPoint(field, field.center)
    expect(Number.isNaN(normal[0])).toBe(false)
    expect(Number.isNaN(normal[1])).toBe(false)
    expect(Number.isNaN(normal[2])).toBe(false)
  })

  it('reports distance to the edge, larger in the middle than at the rim', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    const middle = edgeDistanceAt(field, field.center)
    // A point that actually lies on the horizon is on the boundary, so its
    // normalized distance to the edge is zero.
    const onHorizon = field.horizon[0]
    const edge = edgeDistanceAt(field, onHorizon)
    expect(middle).toBeGreaterThan(edge)
    expect(edge).toBeLessThan(0.05)
  })

  it('scores a perfect sphere as less curved than a lumpy one', () => {
    const pose = poseFromExpression(expression())
    const sphere = buildSurfaceField(pose, surface())
    const lumpy = buildSurfaceField(pose, surface({ type: 'blob', wobble: 0.5, seed: 31 }))
    expect(sphere.curvature).toBeLessThan(lumpy.curvature)
  })

  it('changes with the seed, so the seed controls the surface', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    const point = { x: field.center.x + 20, y: field.center.y - 14 }
    const first = deformNormal([0.3, 0.2, 0.93], point, field, 1, 0.1)
    const second = deformNormal([0.3, 0.2, 0.93], point, field, 2, 0.1)
    expect(first).not.toEqual(second)
  })

  it('leaves the normal untouched when the deformation is zero', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    const base: [number, number, number] = [0.3, 0.2, 0.93]
    expect(deformNormal(base, { x: 1, y: 2 }, field, 5, 0)).toEqual(base)
  })

  it('keeps the deformation small enough to read as imperfection', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    const base: [number, number, number] = [0, 0, 1]
    const deformed = deformNormal(base, field.center, field, 7, 0.05)
    // A tiny perturbation, not a ripple: the z component stays dominant.
    expect(Math.abs(deformed[0])).toBeLessThan(0.15)
    expect(Math.abs(deformed[1])).toBeLessThan(0.15)
    expect(deformed[2]).toBeGreaterThan(0.9)
  })

  it('separates macro from micro frequency', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    const point = { x: field.center.x + 6, y: field.center.y + 4 }
    const variation = sampleSurfaceVariation(point, field, 42)
    expect(finite(variation.macro)).toBe(true)
    expect(finite(variation.micro)).toBe(true)
    // The macro band is the low frequency one, so it varies more slowly.
    const near = sampleSurfaceVariation({ x: point.x + 0.5, y: point.y }, field, 42)
    expect(Math.abs(near.micro - variation.micro)).toBeGreaterThan(
      Math.abs(near.macro - variation.macro)
    )
  })
})

describe('light rig', () => {
  it('places every light outside the body, at a studio distance', () => {
    const lights = rig()
    for (const light of [lights.key, lights.fill, lights.rim]) {
      const length = Math.hypot(light.position.x, light.position.y, light.position.z)
      // A light on the unit sphere would leave the far side unlit, so the rig
      // is pushed out well beyond the silhouette.
      expect(length).toBeGreaterThan(2)
      // The range always covers the whole body, or the falloff would draw a
      // hard terminator across it.
      expect(light.range).toBeGreaterThan(length + 1)
    }
  })

  it('places the fill opposite the key, so the rig is coherent', () => {
    const lights = rig()
    // Opposed on the horizontal axis, which is what a bounce card does.
    expect(Math.sign(lights.fill.position.x)).toBe(-Math.sign(lights.key.position.x))
    expect(Math.sign(lights.fill.position.z)).toBe(-Math.sign(lights.rim.position.z))
  })

  it('keeps the half vector finite and unit length', () => {
    const { halfVector } = rig()
    expect(Math.hypot(halfVector.x, halfVector.y, halfVector.z)).toBeCloseTo(1, 6)
  })

  it('lights a facing surface more than a grazing one', () => {
    const lights = rig()
    const facing = softDiffuse({ x: 0, y: 0, z: 1 }, lights.key)
    const grazing = softDiffuse({ x: 0.9, y: 0, z: 0.1 }, lights.key)
    expect(facing).toBeGreaterThan(grazing)
  })

  it('returns zero behind the light rather than a negative term', () => {
    const lights = rig()
    const behind = softDiffuse(
      { x: -lights.key.position.x, y: -lights.key.position.y, z: -lights.key.position.z },
      lights.key
    )
    expect(behind).toBeGreaterThanOrEqual(0)
  })

  it('never returns NaN or Infinity for any direction', () => {
    const lights = rig()
    for (let index = 0; index < 200; index++) {
      const angle = (index / 200) * Math.PI * 2
      const polar = ((index % 17) / 16) * Math.PI
      const normal: Vec3 = {
        x: Math.sin(polar) * Math.cos(angle),
        y: Math.sin(polar) * Math.sin(angle),
        z: Math.cos(polar),
      }
      for (const light of [lights.key, lights.fill, lights.rim]) {
        expect(finite(softDiffuse(normal, light))).toBe(true)
      }
    }
  })
})

describe('surface terms', () => {
  const surfaceRig = rig()

  it('produces a broad highlight, not a hot spot, for a soft material', () => {
    // A low exponent spreads the lobe: the value away from the peak stays
    // meaningful, which is what a wide soft highlight looks like.
    const near = softSpecular({ x: 0.1, y: 0.1, z: 0.98 }, surfaceRig, 9, 0.4)
    const off = softSpecular({ x: 0.55, y: 0.3, z: 0.78 }, surfaceRig, 9, 0.4)
    expect(near).toBeGreaterThan(off)
    expect(off).toBeGreaterThan(0)
  })

  it('returns exactly zero specular when the strength is zero', () => {
    expect(softSpecular({ x: 0, y: 0, z: 1 }, surfaceRig, 20, 0)).toBe(0)
  })

  it('grows sheen and rim towards grazing angles', () => {
    const facing: Vec3 = { x: 0, y: 0, z: 1 }
    const grazing: Vec3 = { x: 0.95, y: 0, z: 0.1 }
    expect(softSheen(grazing, 3, 0.4)).toBeGreaterThan(softSheen(facing, 3, 0.4))
    expect(softRim(grazing, 2.6, 0.5)).toBeGreaterThan(softRim(facing, 2.6, 0.5))
  })

  it('does not turn a matte body into glass', () => {
    const grazing: Vec3 = { x: 0.95, y: 0, z: 0.1 }
    expect(softRim(grazing, 3, 0.12)).toBeLessThan(0.15)
  })

  it('darkens the edge more than the middle, and never to black', () => {
    const edge = cavityTerm(0, 0.2, 0.4, 0.16)
    const middle = cavityTerm(1, 0.2, 0.4, 0.16)
    expect(edge).toBeGreaterThan(middle)
    expect(edge).toBeLessThanOrEqual(1)
    expect(middle).toBe(0)
  })

  it('reads an irregular region as deeper than a clean one', () => {
    expect(cavityTerm(0.1, 0.9, 0.4, 0.16)).toBeGreaterThan(cavityTerm(0.1, 0, 0.4, 0.16))
  })

  it('is zero when both cavity and ao are off', () => {
    expect(cavityTerm(0, 0.5, 0, 0)).toBe(0)
  })

  it('evaluates the whole formula with finite, non-negative terms', () => {
    const field = buildSurfaceField(poseFromExpression(expression()), surface())
    const material = createBlobMaterial({
      type: 'soft',
      baseColor: '#2f8cff',
      roughness: 0.7,
      grain: 0.2,
      macroNoise: 0.3,
      microNoise: 0.2,
      fiber: 0.2,
      sheen: 0.3,
      specular: 0.3,
      colorVariation: 0.04,
      deformation: 0.05,
      colorSpots: 4,
    })
    for (let step = 0; step < 60; step++) {
      const angle = (step / 60) * Math.PI * 2
      for (const radius of [0, 0.3, 0.6, 0.9, 1]) {
        const shading = shadeSurface({
          normal: {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            z: Math.sqrt(Math.max(0, 1 - radius * radius)),
          },
          edgeDistance: 1 - radius,
          curvature: field.curvature,
          rig: surfaceRig,
          roughness: material.roughness,
          specular: material.specularStrength,
          specularPower: material.specularPower,
          sheen: material.sheen,
          sheenPower: 3.2,
          rim: 1,
          rimPower: 2.6,
          cavityStrength: 1,
          aoStrength: 0.16,
        })
        for (const value of Object.values(shading)) {
          expect(finite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
        }
        // The ambient floor is what keeps the shadow side from crushing.
        expect(shading.diffuseField).toBeGreaterThanOrEqual(shading.ambient)
      }
    }
  })
})

describe('color fields', () => {
  const material = createBlobMaterial({
    type: 'soft',
    baseColor: '#2f8cff',
    roughness: 0.7,
    grain: 0.2,
    macroNoise: 0.3,
    microNoise: 0.2,
    fiber: 0.2,
    sheen: 0.3,
    specular: 0.3,
    colorVariation: 0.04,
    deformation: 0.05,
    colorSpots: 4,
  })

  it('builds the requested number of spots, each a valid colour', () => {
    const fields = buildColorFields({
      material,
      azimuth: 0.5,
      centerX: 0,
      centerY: 0,
      radius: 100,
      axisX: 1,
      axisY: 0,
      count: 4,
      intensity: 0.9,
    })
    expect(fields).toHaveLength(4)
    for (const field of fields) {
      expect(field.color).toMatch(/^#[0-9a-f]{6}$/)
      expect(field.opacity).toBeGreaterThan(0)
      expect(field.opacity).toBeLessThanOrEqual(1)
      expect(field.radius).toBeGreaterThan(0)
    }
  })

  it('keeps the palette rich without going rainbow', () => {
    // Every spot stays a relative of the base hue: no red or green appears in
    // a blue dot's field stack (FASI 56).
    const fields = buildColorFields({
      material,
      azimuth: 0,
      centerX: 0,
      centerY: 0,
      radius: 100,
      axisX: 1,
      axisY: 0,
      count: 5,
      intensity: 1,
    })
    for (const field of fields) {
      const red = Number.parseInt(field.color.slice(1, 3), 16)
      const blue = Number.parseInt(field.color.slice(5, 7), 16)
      expect(blue).toBeGreaterThan(red)
    }
  })

  it('nests the spots along the light axis instead of stacking them', () => {
    const fields = buildColorFields({
      material,
      azimuth: 0,
      centerX: 0,
      centerY: 0,
      radius: 100,
      axisX: 1,
      axisY: 0,
      count: 5,
      intensity: 0.9,
    })
    const positions = fields.map(field => field.cx)
    expect(new Set(positions).size).toBe(fields.length)
  })

  it('is deterministic', () => {
    const input = {
      material,
      azimuth: 0.3,
      centerX: 0,
      centerY: 0,
      radius: 100,
      axisX: 0.95,
      axisY: 0.3,
      count: 4,
      intensity: 0.9,
    }
    expect(buildColorFields(input)).toEqual(buildColorFields(input))
  })

  it('clamps a hostile spot count', () => {
    for (const count of [-5, 0, 99]) {
      const fields = buildColorFields({
        material,
        azimuth: 0,
        centerX: 0,
        centerY: 0,
        radius: 100,
        axisX: 1,
        axisY: 0,
        count,
        intensity: 1,
      })
      expect(fields.length).toBeGreaterThan(0)
      expect(fields.length).toBeLessThanOrEqual(5)
    }
  })
})
