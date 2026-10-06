import { describe, expect, it } from 'vitest'

import { normalizeBlobConfig, sameBlobConfig, validateBlobConfig } from '../blobConfig'
import { createDefaultBlobConfig } from '../blobTypes'

describe('normalizeBlobConfig', () => {
  it('fills in a complete config from nothing', () => {
    const config = normalizeBlobConfig(undefined)
    expect(validateBlobConfig(config)).toEqual([])
    expect(config.material.baseColor).toBe('#2f8cff')
  })

  it('is idempotent', () => {
    const once = normalizeBlobConfig({ shape: { seed: 7 }, material: { baseColor: '#ABC' } })
    const twice = normalizeBlobConfig(once)
    expect(sameBlobConfig(once, twice)).toBe(true)
  })

  it('survives a JSON round trip', () => {
    const config = normalizeBlobConfig(createDefaultBlobConfig())
    expect(sameBlobConfig(config, normalizeBlobConfig(JSON.parse(JSON.stringify(config))))).toBe(
      true
    )
  })

  it('repairs hostile numbers instead of forwarding them', () => {
    const config = normalizeBlobConfig({
      shape: { pointCount: Number.NaN, radius: Number.POSITIVE_INFINITY, seed: -3 },
      lighting: { intensity: Number.NaN, lightZ: 0 },
      material: { baseColor: 'not-a-color', roughness: Number.NaN },
      motion: { breathing: 99 },
    })
    expect(Number.isFinite(config.shape.pointCount)).toBe(true)
    expect(Number.isFinite(config.shape.radius)).toBe(true)
    expect(config.shape.seed).toBeGreaterThanOrEqual(0)
    expect(config.lighting.intensity).toBeGreaterThan(0)
    expect(config.lighting.lightZ).toBeGreaterThan(0)
    expect(config.material.baseColor).toMatch(/^#[0-9a-f]{6}$/)
    expect(config.motion.breathing).toBeLessThanOrEqual(0.2)
    expect(validateBlobConfig(config)).toEqual([])
  })

  it('rejects unknown enum members by falling back to the default', () => {
    const config = normalizeBlobConfig({
      shape: { family: 'banana' },
      material: { type: 'unobtainium' },
      quality: 'cinematic',
    })
    expect(config.shape.family).toBe('round')
    expect(config.material.type).toBe('soft')
    expect(config.quality).toBe('ultra')
  })

  it('drops empty optional colors instead of keeping invalid ones', () => {
    const config = normalizeBlobConfig({
      material: { secondaryColor: '   ', highlightColor: '#f0f' },
    })
    expect(config.material.secondaryColor).toBeUndefined()
    expect(config.material.highlightColor).toBe('#ff00ff')
  })

  it('clamps every slider into its published range', () => {
    const config = normalizeBlobConfig({
      shape: { pointCount: 1, radius: -20, smoothness: 5, elongationX: 99 },
      material: { roughness: -3, grain: 12 },
      lighting: { intensity: 99, rimWidth: -1 },
    })
    expect(config.shape.pointCount).toBe(12)
    expect(config.shape.radius).toBe(8)
    expect(config.shape.smoothness).toBe(1)
    expect(config.shape.elongationX).toBe(3)
    expect(config.material.roughness).toBe(0)
    expect(config.material.grain).toBe(1)
    expect(config.lighting.intensity).toBe(1.5)
    expect(config.lighting.rimWidth).toBe(0)
  })
})

describe('validateBlobConfig', () => {
  it('reports unknown members', () => {
    const problems = validateBlobConfig({
      shape: { family: 'banana' },
      material: { type: 'unobtainium' },
      quality: 'cinematic',
    })
    expect(problems).toEqual(
      expect.arrayContaining([
        'quality must be low|medium|high|ultra',
        'unknown shape family',
        'unknown material type',
      ])
    )
  })

  it('is silent for a valid config', () => {
    expect(validateBlobConfig(createDefaultBlobConfig())).toEqual([])
  })
})
