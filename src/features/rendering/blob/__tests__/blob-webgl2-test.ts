import { describe, expect, it } from 'vitest'

import { defaultDotSurfaceParams } from '@bible-strong/avatar-core'

import { applyBlobShapeFamily } from '../blobGeometry'
import { blobConfigFromLegacyDot, validateBlobConfig } from '../blobConfig'
import { blobMaterialPresets } from '../blobPresets'
import { dotWebgl2UniformDecls, packBlobWebgl2Uniforms, silhouetteLut } from '../blobWebgl2'
import { createDefaultBlobConfig, type BlobConfig } from '../blobTypes'

const labMatrix = (): BlobConfig[] => {
  const families: Parameters<typeof applyBlobShapeFamily>[1][] = [
    'round',
    'bean',
    'amoeba',
    'elongated',
  ]
  return families.flatMap(family =>
    blobMaterialPresets.map(preset =>
      applyBlobShapeFamily(
        {
          ...createDefaultBlobConfig(),
          material: { ...preset.material },
        },
        family
      )
    )
  )
}

const numericEntries = (uniforms: Record<string, unknown>): [string, number][] => {
  const entries: [string, number][] = []
  for (const [key, value] of Object.entries(uniforms)) {
    if (typeof value === 'number') entries.push([key, value])
    if (value instanceof Float32Array) {
      for (const element of value) entries.push([key, element])
    }
    if (Array.isArray(value)) {
      for (const element of value) {
        if (typeof element === 'number') entries.push([key, element])
      }
    }
  }
  return entries
}

describe('blobWebgl2 uniform packing', () => {
  it('is deterministic: same config in, identical uniforms out', () => {
    const config = createDefaultBlobConfig()
    const first = packBlobWebgl2Uniforms({ config })
    const second = packBlobWebgl2Uniforms({ config: { ...config } })
    expect(JSON.stringify({ ...first, uRadiusLut: undefined })).toBe(
      JSON.stringify({ ...second, uRadiusLut: undefined })
    )
    expect(Array.from(first.uRadiusLut)).toEqual(Array.from(second.uRadiusLut))
  })

  it('produces finite uniforms for every material preset and shape family', () => {
    for (const config of labMatrix()) {
      const uniforms = packBlobWebgl2Uniforms({ config })
      for (const [key, value] of numericEntries(uniforms as unknown as Record<string, unknown>)) {
        expect(Number.isFinite(value), `${key} on ${config.material.baseColor}`).toBe(true)
      }
    }
  })

  it('satisfies every uniform the shaders declare — no typos, no dead uniforms', () => {
    const declared = new Set(dotWebgl2UniformDecls().map(decl => decl.name))
    const uniforms = packBlobWebgl2Uniforms({ config: createDefaultBlobConfig() })
    for (const key of Object.keys(uniforms)) {
      expect(declared.has(key), `pack writes ${key}, shaders never declare it`).toBe(true)
    }
    // And the reverse: the shaders never read a uniform the pack forgets.
    for (const name of declared) {
      expect(
        Object.prototype.hasOwnProperty.call(uniforms, name),
        `shader reads ${name}, pack never writes it`
      ).toBe(true)
    }
  })

  it('keeps the light rig camera-anchored and responsive to the config', () => {
    const base = createDefaultBlobConfig()
    const packed = packBlobWebgl2Uniforms({ config: base })
    // The key sits in front of the shape plane (z is the elevation).
    expect(packed.uKeyPos[2]).toBeGreaterThan(0)
    // The light direction follows the config: mirrored lightX mirrors the key.
    const mirrored = packBlobWebgl2Uniforms({
      config: { ...base, lighting: { ...base.lighting, lightX: -base.lighting.lightX } },
    })
    expect(Math.sign(mirrored.uKeyPos[0])).toBe(-Math.sign(packed.uKeyPos[0]))
    // Motion moves the body, never the rig.
    const moved = packBlobWebgl2Uniforms({
      config: base,
      motion: { scaleX: 1, scaleY: 1, translateX: 20, translateY: -10, rotation: 15 },
    })
    expect(moved.uKeyPos).toEqual(packed.uKeyPos)
    expect(moved.uTranslate[0]).toBeCloseTo(20 / 160, 6)
    expect(moved.uRotation).toBeCloseTo((15 * Math.PI) / 180, 6)
  })

  it('gates detail by quality level', () => {
    const base = createDefaultBlobConfig()
    expect(packBlobWebgl2Uniforms({ config: base, quality: 'low' }).uQuality).toBe(0)
    expect(packBlobWebgl2Uniforms({ config: base, quality: 'ultra' }).uQuality).toBe(3)
  })

  it('normalises the ramp against a positive peak', () => {
    const packed = packBlobWebgl2Uniforms({ config: createDefaultBlobConfig() })
    expect(packed.uPeak).toBeGreaterThan(0)
    expect(packed.uAmbient).toBeGreaterThan(0)
  })

  it('silhouette LUT stays in range, round is round and elongated is not', () => {
    const round = silhouetteLut(createDefaultBlobConfig())
    expect(round).toHaveLength(32)
    for (const radius of round) {
      expect(radius).toBeGreaterThan(0)
      expect(radius).toBeLessThan(1.5)
    }
    const spread = Math.max(...round) / Math.min(...round)
    expect(spread).toBeLessThan(1.4)

    const elongated = silhouetteLut(applyBlobShapeFamily(createDefaultBlobConfig(), 'elongated'))
    const elongatedSpread = Math.max(...elongated) / Math.min(...elongated)
    expect(elongatedSpread).toBeGreaterThan(1.5)
  })
})

describe('blobConfigFromLegacyDot', () => {
  it('maps the legacy knobs onto a valid renderer-independent config', () => {
    const legacy = {
      ...defaultDotSurfaceParams,
      color: '#7c5cff',
      wobble: 0.12,
      sssColor: '#b79bff',
      seed: 4242,
      softness: 'softer' as const,
    }
    const config = blobConfigFromLegacyDot(legacy)
    expect(validateBlobConfig(config)).toEqual([])
    expect(config.material.baseColor).toBe('#7c5cff')
    expect(config.material.secondaryColor).toBe('#b79bff')
    expect(config.shape.seed).toBe(4242)
    expect(config.material.deformation).toBeCloseTo(0.12 * 1.2, 6)
    // The studio's own eyes carry the expressions.
    expect(config.expression.enabled).toBe(false)
  })

  it('survives malformed legacy params without producing NaN', () => {
    const broken = {
      ...defaultDotSurfaceParams,
      color: 'not-a-color',
      wobble: Number.NaN,
      seed: Number.POSITIVE_INFINITY,
    }
    const config = blobConfigFromLegacyDot(broken)
    expect(validateBlobConfig(config)).toEqual([])
  })

  it('packs through the WebGL2 path like any other config', () => {
    const uniforms = packBlobWebgl2Uniforms({
      config: blobConfigFromLegacyDot(defaultDotSurfaceParams),
    })
    for (const [, value] of numericEntries(uniforms as unknown as Record<string, unknown>)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})
