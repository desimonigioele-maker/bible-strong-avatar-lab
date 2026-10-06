import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { normalizeBlobConfig } from '../blobConfig'
import { blobMaterialPresets, findBlobMaterialPreset } from '../blobPresets'
import { buildBlobScene, renderBlobToSvg, sampleBlobMotion } from '../blobSvg'
import { resolveSurfacePlan } from '../blobSurface'
import {
  createBlobMaterial,
  deriveBlobPalette,
  isFlatMaterial,
  materialProfiles,
} from '../blobMaterial'
import { createDefaultBlobConfig, renderQualities, type BlobConfig } from '../blobTypes'

const collectIds = (markup: string): string[] =>
  Array.from(markup.matchAll(/id="([^"]+)"/g)).map(m => m[1])

describe('blob material', () => {
  const materialInput = (
    overrides: Partial<Parameters<typeof deriveBlobPalette>[0]> = {}
  ): Parameters<typeof deriveBlobPalette>[0] => ({
    type: 'soft',
    baseColor: '#2f8cff',
    roughness: 0.7,
    grain: 0.2,
    macroNoise: 0.3,
    microNoise: 0.2,
    fiber: 0.2,
    sheen: 0.2,
    specular: 0.3,
    colorVariation: 0.04,
    deformation: 0.05,
    colorSpots: 4,
    ...overrides,
  })

  it('derives every palette slot from one base color', () => {
    const palette = deriveBlobPalette(materialInput())
    for (const value of Object.values(palette)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('orders the ramp light to dark', () => {
    const palette = deriveBlobPalette(materialInput())
    const luminance = (hex: string) => {
      const r = Number.parseInt(hex.slice(1, 3), 16)
      const g = Number.parseInt(hex.slice(3, 5), 16)
      const b = Number.parseInt(hex.slice(5, 7), 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect(luminance(palette.highlight)).toBeGreaterThan(luminance(palette.base))
    expect(luminance(palette.base)).toBeGreaterThan(luminance(palette.shadow))
  })

  it('gives matte no specular and glass the most', () => {
    const material = (type: 'matte' | 'glass' | 'plush') =>
      createBlobMaterial(materialInput({ type, specular: 0.5 }))
    expect(material('matte').specularStrength).toBe(0)
    expect(material('glass').specularStrength).toBeGreaterThan(material('plush').specularStrength)
    expect(material('plush').sheen).toBeGreaterThan(material('matte').sheen)
    expect(materialProfiles.plush.fiber).toBeGreaterThan(materialProfiles.glass.fiber)
  })

  it('never reports a fully flat material for any shipped preset', () => {
    for (const preset of blobMaterialPresets) {
      expect(isFlatMaterial(createBlobMaterial(preset.material))).toBe(false)
    }
  })
})

describe('material presets', () => {
  it('ships every promised preset', () => {
    // AURORA, MILK and SMOOTH joined the original thirteen; the prompt asks
    // for at least sixteen named materials (FASI 36).
    expect(blobMaterialPresets.length).toBeGreaterThanOrEqual(16)
    expect(blobMaterialPresets.map(preset => preset.id)).toEqual(
      expect.arrayContaining([
        'soft-blue',
        'soft-green',
        'soft-yellow',
        'soft-pink',
        'soft-purple',
        'plush-blue',
        'plush-green',
        'plush-yellow',
        'plush-pink',
        'clay',
        'gel',
        'matte',
        'glass',
        'aurora',
        'milk',
        'smooth',
      ])
    )
  })

  it('gives every preset a unique color and id', () => {
    expect(new Set(blobMaterialPresets.map(preset => preset.id)).size).toBe(
      blobMaterialPresets.length
    )
    expect(new Set(blobMaterialPresets.map(preset => preset.material.baseColor)).size).toBe(
      blobMaterialPresets.length
    )
  })

  it('keeps micro colour variation inside the elegant range for every preset', () => {
    // FASI 11: anything above 0.05 reads as a stain, not as a material.
    for (const preset of blobMaterialPresets) {
      expect(preset.material.colorVariation).toBeGreaterThan(0)
      expect(preset.material.colorVariation).toBeLessThanOrEqual(0.05)
    }
  })

  it('looks presets up by id', () => {
    expect(findBlobMaterialPreset('plush-pink')?.material.type).toBe('plush')
    expect(findBlobMaterialPreset('nope')).toBeUndefined()
  })
})

describe('render quality ladder', () => {
  it('adds layers monotonically', () => {
    const material = createBlobMaterial(createDefaultBlobConfig().material)
    const counts = renderQualities.map(quality => resolveSurfacePlan(quality, material).layerCount)
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1])
    }
  })

  it('keeps low quality lean and turns detail on only at the top', () => {
    const material = createBlobMaterial(createDefaultBlobConfig().material)
    const low = resolveSurfacePlan('low', material)
    const ultra = resolveSurfacePlan('ultra', material)
    expect(low.layerCount).toBeLessThanOrEqual(3)
    // The turbulence bands are off at every quality: measured on the
    // acceptance gallery they cost 0.13 saturation and 15 points of range
    // while adding 0.04 texture, so "detail" at the top is the sheen,
    // specular and cavity passes, not grey noise painted over the body.
    expect(low.micro).toBe(false)
    expect(ultra.micro).toBe(false)
    expect(ultra.fiber).toBe(false)
    expect(ultra.layerCount).toBeGreaterThanOrEqual(6)
  })

  it('changes the emitted markup', () => {
    const config = createDefaultBlobConfig()
    expect(renderBlobToSvg(config, { quality: 'low' })).not.toBe(
      renderBlobToSvg(config, { quality: 'ultra' })
    )
  })
})

describe('svg serialization', () => {
  it('is byte-identical for the same config', () => {
    const config = createDefaultBlobConfig()
    expect(renderBlobToSvg(config)).toBe(renderBlobToSvg(config))
  })

  it('changes when the seed changes', () => {
    const config = createDefaultBlobConfig()
    expect(renderBlobToSvg({ ...config, shape: { ...config.shape, seed: 1 } })).not.toBe(
      renderBlobToSvg({ ...config, shape: { ...config.shape, seed: 2 } })
    )
  })

  it('keeps ids unique across several blobs on one page', () => {
    const config = createDefaultBlobConfig()
    const first = renderBlobToSvg(config, { idPrefix: 'a', width: 100 })
    const second = renderBlobToSvg(config, { idPrefix: 'b', width: 100 })
    const firstIds = collectIds(first)
    const secondIds = collectIds(second)
    expect(new Set(firstIds).size).toBe(firstIds.length)
    expect(new Set(secondIds).size).toBe(secondIds.length)
    expect(firstIds.filter(id => secondIds.includes(id))).toEqual([])
  })

  it('emits no NaN, undefined or external reference', () => {
    const svg = renderBlobToSvg(createDefaultBlobConfig(), { label: 'Blob' })
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('undefined')
    expect(svg).not.toContain('<link')
    expect(svg).not.toContain('<style')
    expect(svg).not.toContain('class=')
    // Only the SVG namespace is allowed to be an absolute URL.
    expect(svg.match(/https?:\/\/[^\s"']+/g)).toEqual(['http://www.w3.org/2000/svg'])
  })

  it('references only ids it defines itself', () => {
    const scene = buildBlobScene(createDefaultBlobConfig(), { idPrefix: 'x' })
    const markup = scene.defs + scene.body + scene.face
    const defined = new Set(collectIds(markup))
    const referenced = Array.from(markup.matchAll(/url\(#([^)]+)\)/g)).map(match => match[1])
    expect(referenced.length).toBeGreaterThan(0)
    for (const id of referenced) expect(defined.has(id)).toBe(true)
  })

  it('hides decorative blobs and labels meaningful ones', () => {
    const config = createDefaultBlobConfig()
    expect(renderBlobToSvg(config)).toContain('aria-hidden="true"')
    expect(renderBlobToSvg(config, { label: 'A blue blob' })).toContain('aria-label="A blue blob"')
  })

  it('can drop the face for body-only graphics', () => {
    const config = createDefaultBlobConfig()
    // Pupils are circles, and the mouth is the only stroked path, so these
    // markers identify the face without matching the ground shadow ellipse.
    expect(renderBlobToSvg(config, { withExpression: false })).not.toContain('<circle')
    expect(renderBlobToSvg(config, { withExpression: false })).not.toContain('stroke-linecap')
    expect(renderBlobToSvg(config, { withExpression: true })).toContain('<circle')
  })

  it('stays finite when the config is hostile', () => {
    const config = normalizeBlobConfig({
      shape: { seed: 0, pointCount: 12, radius: 8, elongationX: 0.2, elongationY: 3 },
      lighting: { lightX: 0, lightY: 0, lightZ: 0.05, intensity: 0, ambient: 0 },
      material: { type: 'glass', baseColor: '#000000' },
      quality: 'ultra',
    })
    const svg = renderBlobToSvg(config)
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('<svg')
  })
})

describe('motion sampling', () => {
  const base = createDefaultBlobConfig()

  it('rests when motion is disabled', () => {
    const sample = sampleBlobMotion({ ...base.motion, enabled: false }, 12.3)
    expect(sample).toEqual({ scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, rotation: 0 })
  })

  it('is deterministic and zero at t = 0 for breathing', () => {
    expect(sampleBlobMotion(base.motion, 1.5)).toEqual(sampleBlobMotion(base.motion, 1.5))
    expect(sampleBlobMotion(base.motion, 0).scaleY).toBeCloseTo(1, 6)
  })

  it('stays subtle', () => {
    for (let t = 0; t < 30; t += 0.37) {
      const sample = sampleBlobMotion(base.motion, t)
      expect(Math.abs(sample.scaleY - 1)).toBeLessThan(0.05)
      expect(Math.abs(sample.rotation)).toBeLessThan(5)
    }
  })

  it('runs surface drift on its own oscillator, independent of float', () => {
    // The drift knob must actually move drift (it used to be dead: drift shared
    // float's oscillator), and changing it must leave float untouched.
    const faster = { ...base.motion, surfaceDriftSpeed: base.motion.surfaceDriftSpeed * 3 + 0.7 }
    let driftMoved = 0
    for (const t of [1.3, 2.7, 4.1, 9.5]) {
      const a = sampleBlobMotion(base.motion, t)
      const b = sampleBlobMotion(faster, t)
      expect(b.translateY).toBe(a.translateY)
      if (Math.abs(a.translateX - b.translateX) > 1e-6) driftMoved += 1
    }
    expect(driftMoved).toBe(4)
  })
})

describe('engine source hygiene', () => {
  it('contains no Math.random and no Date.now in the runtime modules', () => {
    const directory = fileURLToPath(new URL('..', import.meta.url))
    const stripComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const offenders: string[] = []
    for (const entry of readdirSync(directory)) {
      if (!entry.endsWith('.ts') || entry.includes('__tests__')) continue
      const source = stripComments(readFileSync(`${directory}/${entry}`, 'utf8'))
      if (source.includes('Math.random') || source.includes('Date.now')) offenders.push(entry)
    }
    expect(offenders).toEqual([])
  })
})

describe('config independence', () => {
  it('lets a material change without touching the silhouette', () => {
    const base = createDefaultBlobConfig() as BlobConfig
    const baseGeometry = buildBlobScene(base).geometry.path
    const recolored = { ...base, material: { ...base.material, baseColor: '#ff0000' } }
    const reshaped = { ...base, shape: { ...base.shape, seed: 4242 } }
    expect(buildBlobScene(recolored).geometry.path).toBe(baseGeometry)
    expect(buildBlobScene(reshaped).geometry.path).not.toBe(baseGeometry)
  })
})
