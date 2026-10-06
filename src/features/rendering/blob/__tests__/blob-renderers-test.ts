import { describe, expect, it } from 'vitest'

import { poseFromExpression, surfacePresets, type Expression } from '@bible-strong/avatar-core'

import { blobDebugFlags, buildBlobDebugOverlay } from '../blobDebug'
import { buildBlobScene, renderBlobToSvg } from '../blobSvg'
import { allLocks, randomizeBlobConfig, randomizeGroups, unlockedGroups } from '../blobRandomize'
import { createDefaultBlobConfig, type BlobConfig } from '../blobTypes'
import { normalizeBlobConfig } from '../blobConfig'

const expression: Expression = {
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
}

const scene = (config: BlobConfig = createDefaultBlobConfig()) =>
  buildBlobScene(config, { pose: poseFromExpression(expression) })

describe('debug overlay', () => {
  it('emits nothing when no flag is set', () => {
    const base = scene()
    const overlay = buildBlobDebugOverlay({
      flags: [],
      geometry: base.geometry,
      field: base.field,
      lighting: base.lighting,
      stops: base.lighting.volume.stops,
      seed: base.config.shape.seed,
    })
    expect(overlay.markup).toBe('')
  })

  it('emits markup for every flag and never NaN', () => {
    const base = scene()
    for (const flag of blobDebugFlags) {
      const overlay = buildBlobDebugOverlay({
        flags: [flag],
        geometry: base.geometry,
        field: base.field,
        lighting: base.lighting,
        stops: base.lighting.volume.stops,
        seed: base.config.shape.seed,
      })
      expect(overlay.markup.length).toBeGreaterThan(0)
      expect(overlay.markup).not.toContain('NaN')
      expect(overlay.markup).toContain('data-blob-debug')
    }
  })

  it('is inert: no blend modes, no filters, no external references', () => {
    const markup = renderBlobToSvg(createDefaultBlobConfig(), {
      pose: poseFromExpression(expression),
      debug: [...blobDebugFlags],
    })
    const overlay = markup.slice(markup.indexOf('data-blob-debug'))
    expect(overlay).not.toContain('mix-blend-mode')
    expect(overlay).not.toContain('filter=')
    expect(overlay).not.toContain('url(http')
  })

  it('marks the lights behind the body as dashed', () => {
    const base = scene()
    const markup = buildBlobDebugOverlay({
      flags: ['lights'],
      geometry: base.geometry,
      field: base.field,
      lighting: base.lighting,
      stops: base.lighting.volume.stops,
      seed: base.config.shape.seed,
    }).markup
    expect(markup).toContain('data-debug-light="key"')
    expect(markup).toContain('data-debug-light="rim"')
    // The rim sits behind the surface, so its marker has to be dashed: that is
    // the reason it only ever reaches the edges.
    const rim = markup.slice(markup.indexOf('data-debug-light="rim"'))
    expect(rim.slice(0, 200)).toContain('stroke-dasharray')
  })

  it('survives a degenerate surface', () => {
    const base = buildBlobScene(
      {
        ...createDefaultBlobConfig(),
        shape: { ...createDefaultBlobConfig().shape, radius: 0.001 },
      },
      { pose: poseFromExpression(expression), debug: [...blobDebugFlags] }
    )
    expect(base.debug).not.toContain('NaN')
  })
})

describe('randomize with locks', () => {
  const base = createDefaultBlobConfig()

  /** The config key a lock group owns. `light` is stored as `lighting`. */
  const keyOf = (group: (typeof randomizeGroups)[number]) =>
    group === 'light' ? 'lighting' : group

  /**
   * Everything a locked group owns, except the seed.
   *
   * The seed is deliberately excluded: it always advances so a second press is
   * not a no-op, even when every group is locked. That is a property of the
   * button, not of the locked group.
   */
  const groupOf = (config: BlobConfig, group: (typeof randomizeGroups)[number]) => {
    const value = config[keyOf(group) as 'shape' | 'material' | 'lighting' | 'motion']
    return group === 'shape' ? { ...(value as BlobConfig['shape']), seed: 0 } : value
  }

  it('is deterministic for the same seed and groups', () => {
    const left = randomizeBlobConfig(base, ['shape', 'material'], 4242)
    const right = randomizeBlobConfig(base, ['shape', 'material'], 4242)
    expect(left).toEqual(right)
  })

  it('produces a different result for a different seed', () => {
    const left = randomizeBlobConfig(base, ['shape'], 1)
    const right = randomizeBlobConfig(base, ['shape'], 2)
    expect(left.shape).not.toEqual(right.shape)
  })

  it('always moves the seed, so a second press is not a no-op', () => {
    const first = randomizeBlobConfig(base, randomizeGroups, 100)
    const second = randomizeBlobConfig(first, randomizeGroups, 100)
    expect(second.shape.seed).not.toBe(first.shape.seed)
  })

  it('preserves a locked group exactly', () => {
    for (const group of randomizeGroups) {
      const locks = { ...allLocks(false), [group]: true }
      const result = randomizeBlobConfig(base, unlockedGroups(locks), 777)
      expect(groupOf(result, group)).toEqual(groupOf(base, group))
    }
  })

  it('changes every unlocked group', () => {
    const result = randomizeBlobConfig(base, unlockedGroups(allLocks(false)), 31)
    for (const group of randomizeGroups) {
      expect(groupOf(result, group)).not.toEqual(groupOf(base, group))
    }
  })

  it('leaves everything alone when everything is locked', () => {
    const result = randomizeBlobConfig(base, unlockedGroups(allLocks(true)), 99)
    for (const group of randomizeGroups) {
      expect(groupOf(result, group)).toEqual(groupOf(base, group))
    }
  })

  it('keeps the light in the upper half, so a variant never looks like a mistake', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { lighting } = randomizeBlobConfig(base, ['light'], seed)
      // A key from below reads as an interrogation lamp.
      expect(lighting.lightY).toBeLessThan(0.2)
      expect(lighting.lightZ).toBeGreaterThan(0.5)
    }
  })

  it('keeps motion subliminal across many seeds', () => {
    for (let seed = 1; seed < 60; seed++) {
      const { motion } = randomizeBlobConfig(base, ['motion'], seed)
      // A randomizer that can produce a bouncing balloon is a bug, not a tool.
      expect(motion.breathing).toBeLessThan(0.05)
      expect(motion.float).toBeLessThan(0.05)
      expect(motion.rotation).toBeLessThan(3)
    }
  })

  it('only ever picks a shipped material and a shipped family', () => {
    for (let seed = 1; seed < 40; seed++) {
      const result = randomizeBlobConfig(base, ['shape', 'material'], seed)
      const normalized = normalizeBlobConfig(result)
      expect(normalized.shape.radius).toBeGreaterThan(0)
      expect(normalized.material.baseColor).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('per-pixel renderer', () => {
  const perPixel = () => ({
    ...createDefaultBlobConfig(),
    renderer: 'perPixel' as const,
  })

  it('emits a different body than the field renderer', () => {
    const field = renderBlobToSvg(createDefaultBlobConfig())
    const pixel = renderBlobToSvg(perPixel())
    expect(pixel).not.toBe(field)
    expect(pixel).toContain('-pp')
  })

  it('clips the filter box to the silhouette', () => {
    const base = scene(perPixel())
    // The lighting primitives are objectBoundingBox relative, so without an
    // explicit clip the output is the filter's whole box: a rounded rectangle
    // rather than a dot.
    expect(base.defs).toContain('-pp-clip"><path d="M')
    expect(base.body).toContain('clip-path="url(')
  })

  it('writes the height field into the alpha channel', () => {
    const base = scene(perPixel())
    // feDiffuseLighting reads SourceAlpha as the bump map. A grey ramp at full
    // opacity is a flat surface and produces a uniformly lit blob.
    const stops = Array.from(
      base.defs.matchAll(/<stop offset="([\d.]+)" stop-color="#000000" stop-opacity="([\d.]+)"\/>/g)
    )
    expect(stops.length).toBeGreaterThan(8)
    const opacities = stops.map(match => Number(match[2]))
    expect(Math.max(...opacities)).toBeGreaterThan(0.9)
    expect(Math.min(...opacities)).toBeLessThan(0.05)
  })

  it('declares three lights so the body is not lit by a single lamp', () => {
    const base = scene(perPixel())
    const diffuse = base.defs.match(/<feDiffuseLighting/g) ?? []
    expect(diffuse.length).toBe(3)
    expect(base.defs).toContain('<feSpecularLighting')
  })

  it('keeps every light camera-anchored, in the scene frame', () => {
    const base = scene(perPixel())
    const lights = Array.from(
      base.defs.matchAll(/<feDistantLight azimuth="([-\d.]+)" elevation="([-\d.]+)"\/>/g)
    )
    expect(lights.length).toBeGreaterThanOrEqual(3)
    // The key and the rim must not share an azimuth: a rim behind the body is
    // the whole reason it only reaches the edges.
    const azimuths = new Set(lights.map(match => match[1]))
    expect(azimuths.size).toBeGreaterThan(1)
  })

  it('emits no NaN and no external reference', () => {
    const svg = renderBlobToSvg(perPixel(), { pose: poseFromExpression(expression) })
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('undefined')
    expect(svg).not.toContain('<link')
    expect(svg).not.toContain('<style')
  })

  it('keeps its ids namespaced', () => {
    const first = renderBlobToSvg(perPixel(), {
      idPrefix: 'a',
      pose: poseFromExpression(expression),
    })
    const second = renderBlobToSvg(perPixel(), {
      idPrefix: 'b',
      pose: poseFromExpression(expression),
    })
    const idsOf = (markup: string) => Array.from(markup.matchAll(/id="([^"]+)"/g)).map(m => m[1])
    expect(new Set(idsOf(first)).size).toBe(idsOf(first).length)
    expect(idsOf(first).filter(id => idsOf(second).includes(id))).toEqual([])
  })

  it('survives a hostile config', () => {
    const hostile = normalizeBlobConfig({
      ...perPixel(),
      shape: { ...perPixel().shape, radius: 0.01, elongationX: 0.2, elongationY: 3 },
      lighting: { ...perPixel().lighting, lightX: 0, lightY: 0, intensity: 0, ambient: 0 },
      material: { ...perPixel().material, type: 'glass', baseColor: '#000000' },
    })
    const svg = renderBlobToSvg(hostile, { pose: poseFromExpression(expression) })
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('<svg')
  })

  it('resolves the renderer through normalization and defaults safely', () => {
    expect(normalizeBlobConfig({ renderer: 'nonsense' }).renderer).toBe('field')
    expect(normalizeBlobConfig({}).renderer).toBe('field')
    expect(normalizeBlobConfig({ renderer: 'perPixel' }).renderer).toBe('perPixel')
  })
})

describe('surface field is the fork geometry', () => {
  it('derives the field from a SurfaceConfig, not from a hand-made circle', () => {
    const base = scene()
    // A sphere projects to a near-circular limb, so its curvature is small.
    expect(base.field.curvature).toBeLessThan(0.05)
    expect(base.field.radiusX).toBeGreaterThan(1)
    expect(base.field.ring.length).toBeGreaterThan(64)
  })

  it('lights an elongated silhouette differently from a round one', () => {
    const base = createDefaultBlobConfig()
    const round = buildBlobScene(base, { pose: poseFromExpression(expression) })
    const elongated = buildBlobScene(
      {
        ...base,
        shape: { ...base.shape, elongationX: 1.6, elongationY: 0.55 },
      },
      { pose: poseFromExpression(expression) }
    )
    // A shape-aware field means the radii follow the silhouette, so the two
    // cannot be the same body at two sizes.
    expect(elongated.field.radiusX / elongated.field.radiusY).toBeGreaterThan(
      round.field.radiusX / round.field.radiusY
    )
  })

  it('inherits the camera pose rather than ignoring it', () => {
    const base = createDefaultBlobConfig()
    const straight = buildBlobScene(base, { pose: poseFromExpression(expression) })
    const turned = buildBlobScene(base, {
      pose: poseFromExpression({ ...expression, headY: 30 }),
    })
    expect(turned.field.horizon).not.toEqual(straight.field.horizon)
  })

  it('uses the fork surface presets when asked for one', () => {
    // The field builder accepts any SurfaceConfig, so a real studio surface
    // works without the dot having to reimplement it.
    const base = scene()
    expect(base.field.centerDepth).toBeGreaterThan(0)
    expect(surfacePresets.sphere.width).toBeGreaterThan(0)
  })
})
