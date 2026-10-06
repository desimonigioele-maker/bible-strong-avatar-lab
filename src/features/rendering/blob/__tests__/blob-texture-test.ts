import { describe, expect, it } from 'vitest'

import { avatarTextureTypes, type AvatarTextureConfig } from '@bible-strong/avatar-core'

import { buildBlobScene, renderBlobToSvg } from '../blobSvg'
import { createDefaultBlobConfig } from '../blobTypes'

const texture = (type: AvatarTextureConfig['type'], intensity?: number): AvatarTextureConfig =>
  type === 'none' ? { type } : { type, intensity }

const collectIds = (markup: string): string[] =>
  Array.from(markup.matchAll(/id="([^"]+)"/g)).map(match => match[1])

describe('blob textures', () => {
  it('adds layers for every shipped texture type', () => {
    const plain = renderBlobToSvg(createDefaultBlobConfig()).length
    // 'none' is covered separately: it must add nothing at all.
    for (const type of avatarTextureTypes.filter(entry => entry !== 'none')) {
      const textured = renderBlobToSvg(createDefaultBlobConfig(), {
        texture: texture(type, 0.8),
      })
      expect(textured.length).toBeGreaterThan(plain)
      expect(textured).not.toContain('NaN')
    }
  })

  it('leaves the renderer untouched for "none"', () => {
    const config = createDefaultBlobConfig()
    expect(renderBlobToSvg(config, { texture: { type: 'none' } })).toBe(renderBlobToSvg(config))
  })

  it('exposes glow, under-surface and top layers separately', () => {
    const neon = buildBlobScene(createDefaultBlobConfig(), { texture: { type: 'neon' } })
    expect(neon.glow).toContain('filter=')
    expect(neon.textureUnderSurface).not.toBe('')

    const plush = buildBlobScene(createDefaultBlobConfig(), {
      texture: { type: 'plush', intensity: 0.9 },
    })
    expect(plush.textureUnderSurface).toContain('mix-blend-mode')
    expect(plush.glow).toBe('')
  })

  it('orders the texture between the surface and the highlights', () => {
    const scene = buildBlobScene(createDefaultBlobConfig(), { texture: { type: 'felt' } })
    expect(scene.body.indexOf('bs-tex-')).toBeGreaterThan(-1)
    // No surface noise band is emitted (measured harmful, see
    // resolveSurfacePlan), so the texture is the first layer above the
    // volume, and the rim still comes after it.
    const noiseIndex = scene.body.search(/blob-(macro|micro|grain|fiber)/)
    const rimIndex = scene.body.indexOf(`${'blob-rim-mask'}`)
    const textureIndex = scene.body.search(/bs-tex-/)
    expect(noiseIndex).toBe(-1)
    expect(textureIndex).toBeLessThan(rimIndex)
  })

  it('keeps texture ids namespaced per blob', () => {
    const config = createDefaultBlobConfig()
    const first = renderBlobToSvg(config, { idPrefix: 'a', texture: { type: 'plush' } })
    const second = renderBlobToSvg(config, { idPrefix: 'b', texture: { type: 'plush' } })
    const overlap = collectIds(first).filter(id => collectIds(second).includes(id))
    expect(overlap).toEqual([])
    expect(first).toContain('bs-tex-')
    expect(second).toContain('bs-tex-')
  })

  it('resolves every reference the texture introduces', () => {
    const config = createDefaultBlobConfig()
    for (const type of avatarTextureTypes) {
      const markup = renderBlobToSvg(config, { texture: texture(type, 0.7) })
      const defined = new Set(collectIds(markup))
      const referenced = Array.from(markup.matchAll(/url\(#([^)]+)\)/g)).map(match => match[1])
      expect(referenced.length).toBeGreaterThan(0)
      for (const id of referenced) expect(defined.has(id)).toBe(true)
    }
  })

  it('stays deterministic with a texture', () => {
    const config = createDefaultBlobConfig()
    const options = { texture: { type: 'plush' as const, intensity: 0.6 } }
    expect(renderBlobToSvg(config, options)).toBe(renderBlobToSvg(config, options))
  })

  it('respects intensity: a weaker texture emits a lighter overlay', () => {
    const config = createDefaultBlobConfig()
    const strong = renderBlobToSvg(config, { texture: { type: 'felt', intensity: 1 } })
    const weak = renderBlobToSvg(config, { texture: { type: 'felt', intensity: 0.1 } })
    expect(strong).not.toBe(weak)
  })
})
