/**
 * Render cost budget for the DOT renderer.
 *
 * The field renderer is a set of gradient overlays and the per-pixel renderer
 * is a filter chain, so both grow silently: nobody notices a probe count double
 * until an exported avatar crawls on a phone. These numbers are what the dot
 * costs today, at the largest quality, and they are the tripwire.
 *
 * The build time matters as much as the markup. The exported runtime resamples
 * the surface whenever the pose signature changes, so a 30 fps ambient drift
 * pays this cost every frame; anything past a couple of milliseconds turns a
 * subtle breathing motion into a stutter.
 */

import { poseFromExpression, type Expression } from '@bible-strong/avatar-core'
import { describe, expect, it } from 'vitest'

import { blobDebugFlags, type BlobDebugFlag } from '../blobDebug'
import { buildBlobScene } from '../blobSvg'
import { createDefaultBlobConfig, type BlobConfig, type RenderQuality } from '../blobTypes'

const expression: Expression = {
  id: 'perf',
  headX: 14,
  headY: -6,
  headZ: 20,
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
  perspective: 0.24,
  eyeMotion: 'none',
  bodyMotion: 'none',
}

const markupCost = (markup: string) => ({
  tags: markup.match(/<[a-zA-Z]/g)?.length ?? 0,
  filters: markup.match(/<filter\b/g)?.length ?? 0,
  primitives: markup.match(/<fe[A-Z]/g)?.length ?? 0,
  bytes: markup.length,
})

const sceneCost = (config: BlobConfig, debug?: BlobDebugFlag[]) => {
  const scene = buildBlobScene(config, {
    pose: poseFromExpression(expression),
    debug,
  })
  const markup = scene.defs + scene.body + scene.glow + scene.shadow + scene.debug
  return { ...markupCost(markup), scene }
}

const config = (renderer: BlobConfig['renderer'], quality: RenderQuality): BlobConfig => ({
  ...createDefaultBlobConfig(),
  renderer,
  quality,
})

describe('DOT renderer cost', () => {
  it('keeps every quality of the field renderer inside the node budget', () => {
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      const cost = sceneCost(config('field', quality))
      expect(cost.tags).toBeLessThanOrEqual(160)
      expect(cost.filters).toBeLessThanOrEqual(8)
      expect(cost.bytes).toBeLessThanOrEqual(40000)
    }
  })

  it('keeps every quality of the per-pixel renderer inside the node budget', () => {
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      const cost = sceneCost(config('perPixel', quality))
      expect(cost.tags).toBeLessThanOrEqual(200)
      // Three lights plus specular plus the glow, roughly.
      expect(cost.primitives).toBeLessThanOrEqual(36)
      expect(cost.bytes).toBeLessThanOrEqual(45000)
    }
  })

  it('resamples a scene in well under a frame budget', () => {
    for (const renderer of ['field', 'perPixel'] as const) {
      const scene = config(renderer, 'ultra')
      const rounds = 10
      // Each round is timed on its own and the fastest one counts: the suite
      // runs many files in parallel, so the *mean* wall time of a loop also
      // measures how often sibling workers preempt this thread, which turns
      // the assertion into a machine-load check. The fastest round is the
      // actual cost of building the scene, and a real regression (more
      // probes, a second shading pass) raises it just the same.
      const timings: number[] = []
      for (let index = 0; index < rounds; index += 1) {
        const started = performance.now()
        buildBlobScene(scene, { pose: poseFromExpression(expression) })
        timings.push(performance.now() - started)
      }
      expect(Math.min(...timings)).toBeLessThan(12)
    }
  })

  it('keeps the debug overlay inert until it is asked for', () => {
    const plain = sceneCost(config('field', 'high'))
    const marked = sceneCost(config('field', 'high'), [...blobDebugFlags])
    expect(plain.scene.debug).toBe('')
    expect(marked.scene.debug.length).toBeGreaterThan(0)
    // Diagnostics are a tool, not a feature: the overlay has to stay a small
    // share of the scene even with every flag on.
    expect(marked.bytes - plain.bytes).toBeLessThan(plain.bytes * 2)
  })
})
