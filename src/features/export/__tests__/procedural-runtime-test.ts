/**
 * The exported browser runtime is a string, so nothing about it is typechecked
 * or exercised by the studio tests. That is how a branch of the render loop can
 * quietly diverge from the one next to it and ship.
 *
 * These tests mount the real `mountAvatar` from the runtime source inside jsdom
 * with a stub engine and a faithful frame queue, then drive it with a manual
 * clock. The DOT branch is the one that drifted: it armed its own animation
 * frame from `render` as well as letting `tick` arm one, which forked the loop
 * in two, and it dropped the ambient eye offset so an exported dot held a stare
 * while the sphere it was copied from looked around. Both are asserted here, so
 * the next divergence has to be written on purpose.
 *
 * @vitest-environment jsdom
 */

import {
  ambientBodyOffset,
  ambientEyeOffset,
  applyAmbientBodyMotion,
  expressionFields,
  hasAmbientMotion,
  poseFromExpression,
  renderAvatar,
  surfacePresets,
  type Expression,
} from '@bible-strong/avatar-core'
import { parse } from '@babel/parser'
import { proceduralBrowserRuntime } from '@/features/export/proceduralBrowserRuntime'

type AvatarApi = {
  play: (name?: string) => unknown
  pause: () => unknown
  destroy: () => unknown
  element: Element
}

const expression = (overrides: Partial<Expression> = {}): Expression => ({
  id: 'idle',
  headX: 0,
  headY: 0,
  headZ: 0,
  widthLeft: 46,
  widthRight: 46,
  heightLeft: 56,
  heightRight: 56,
  spacing: 62,
  positionXLeft: -31,
  positionXRight: 31,
  positionYLeft: 6,
  positionYRight: 6,
  leftAngle: 0,
  rightAngle: 0,
  perspective: 0.35,
  eyeMotion: 'none',
  bodyMotion: 'none',
  ...overrides,
})

const idleExpression = expression({
  id: 'idle',
  eyeMotion: 'microSaccades',
  bodyMotion: 'slowDrift',
})
const turnedExpression = expression({ id: 'turned', headX: 24, headY: -12 })

const blink = {
  enabled: false,
  initialDelayMs: 100,
  durationMs: 100,
  minIntervalMs: 100,
  maxIntervalMs: 100,
}
const step = (expressionId: string, transitionMs: number) => ({
  expressionId,
  transitionMs,
  holdMs: 100,
  transition: 'smooth' as const,
})

type Harness = {
  mountAvatar: (options?: Record<string, unknown>) => AvatarApi
  host: HTMLElement
  clock: { value: number }
  /** Run every armed frame for the given duration without moving the real clock. */
  advance: (ms: number) => void
  /** Frames still armed right now. More than one means the loop is forked. */
  pending: () => number
  eyeOffsets: { x: number; y: number }[]
  headAngles: number[]
  blobBuilds: number
  surface: Record<string, unknown>
  /** How many nodes the DOT defs block holds right now. */
  dotDefsNodes: () => number
}

/**
 * Build the runtime with a stub engine that records what the render loop asks
 * for. The geometry, pose and ambient helpers are the real ones: the point is
 * to test the branch, not to re-implement the inputs it consumes.
 *
 * The frame queue keeps handles the way the browser does, because the bug being
 * guarded is a handle that `pause` and `destroy` never learn about. A queue
 * that clears wholesale on cancel would hide exactly that.
 */
const createHarness = (surfaceOverride?: Record<string, unknown>): Harness => {
  const state = {
    clock: { value: 0 },
    eyeOffsets: [] as { x: number; y: number }[],
    headAngles: [] as number[],
    blobBuilds: 0,
    nextHandle: 1,
  }
  const queue = new Map<number, (time: number) => void>()
  const DATA = {
    avatar: {
      name: 'Runtime blob',
      colors: { body: '#3a7bd5', eyes: '#101820' },
      surface: surfaceOverride ?? { ...surfacePresets.softDot },
      bodyNodes: [],
      texture: null,
      renderStyle: null,
    },
    animations: {
      idle: {
        steps: [step('idle', 0), step('idle', 0)],
        playbackMode: 'loop',
        blink,
      },
      turn: {
        // A single step that is itself a one second transition: a forked loop
        // never reaches the tick that advances it, which is the whole failure.
        steps: [step('turned', 1000)],
        playbackMode: 'once',
        blink,
      },
    },
    expressions: { idle: idleExpression, turned: turnedExpression },
  }
  const engine = {
    expressionFields,
    poseFromExpression,
    ambientBodyOffset,
    ambientEyeOffset,
    applyAmbientBodyMotion,
    hasAmbientMotion,
    softDotConfigFromSurface: (surface: unknown) => surface,
    buildBlobScene: () => {
      state.blobBuilds += 1
      return {
        defs: '<linearGradient id="avatar-dot-volume"><stop offset="0"/><stop offset="1"/></linearGradient>',
        glow: '',
        shadow: '',
        body: '<path id="dot-body" d="M0 0"/>',
      }
    },
    renderAvatar: (
      pose: ReturnType<typeof poseFromExpression>,
      surface: unknown,
      blinkAmount: number,
      options: { eyeOffset?: { x: number; y: number } }
    ) => {
      state.eyeOffsets.push(options.eyeOffset ?? { x: 0, y: 0 })
      state.headAngles.push(pose.expression.headX)
      return renderAvatar(pose, surface as never, blinkAmount, options)
    },
  }
  const build = new Function(
    'AvatarProceduralEngine',
    'DATA',
    'document',
    'window',
    'performance',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    `${proceduralBrowserRuntime}\nreturn mountAvatar;`
  ) as (...args: unknown[]) => (target: HTMLElement, options?: Record<string, unknown>) => AvatarApi
  const mountAvatar = build(
    engine,
    DATA,
    document,
    window,
    { now: () => state.clock.value },
    (callback: (time: number) => void) => {
      const handle = state.nextHandle++
      queue.set(handle, callback)
      return handle
    },
    (handle: number) => {
      queue.delete(handle)
    }
  )
  const host = document.createElement('div')
  document.body.append(host)
  const advance = (ms: number) => {
    const steps = Math.max(1, Math.round(ms / 100))
    for (let step = 0; step < steps; step += 1) {
      state.clock.value += 100
      // A frame that arms another frame must not run in the same flush, which
      // is the whole point: a forked loop would keep growing here.
      for (let guard = 0; guard < 8 && queue.size > 0; guard += 1) {
        const pending = [...queue.entries()]
        queue.clear()
        pending.forEach(([, frame]) => frame(state.clock.value))
      }
    }
  }
  return {
    mountAvatar: options => mountAvatar(host, options),
    host,
    clock: state.clock,
    advance,
    pending: () => queue.size,
    eyeOffsets: state.eyeOffsets,
    headAngles: state.headAngles,
    surface: DATA.avatar.surface,
    dotDefsNodes: () => host.querySelector('[data-avatar-dot-defs]')?.children.length ?? 0,
    get blobBuilds() {
      return state.blobBuilds
    },
  }
}

describe('exported procedural runtime', () => {
  it('parses as valid JavaScript', () => {
    expect(() =>
      parse(proceduralBrowserRuntime, { sourceType: 'script', plugins: ['optionalChaining'] })
    ).not.toThrow()
  })

  it('advances an expression transition on the blob surface', () => {
    const harness = createHarness()
    const avatar = harness.mountAvatar({ animation: 'idle', autoplay: false })
    // `turn` is a single one second step away from the idle pose.
    avatar.play('turn')
    harness.advance(1200)
    // The head turns 24 degrees. Ambient drift alone stays under one degree, so
    // this only holds if the tick that interpolates the transition ever ran.
    expect(Math.max(...harness.headAngles)).toBeGreaterThan(20)
    expect(harness.blobBuilds).toBeGreaterThan(1)
    const layer = harness.host.querySelector('g') as SVGGElement
    expect(layer.getAttribute('transform')).toContain('translate(')
  })

  it('renders once per frame instead of running a second chain beside it', () => {
    const harness = createHarness()
    harness.mountAvatar({ animation: 'idle', autoplay: false })
    const before = harness.eyeOffsets.length
    // Three 100 ms steps. The ambient loop is capped at 30 fps, so one render
    // per step is the whole budget. A self-scheduling render quietly spends the
    // whole frame budget again on itself.
    harness.advance(300)
    expect(harness.eyeOffsets.length - before).toBe(3)
    expect(harness.pending()).toBe(1)
  })

  it('stops rendering once paused', () => {
    const harness = createHarness()
    const avatar = harness.mountAvatar({ animation: 'idle', autoplay: false })
    harness.advance(300)
    avatar.pause()
    expect(harness.pending()).toBe(0)
    // Pause draws one last frame on purpose; what must not happen is another.
    const afterPause = harness.eyeOffsets.length
    harness.advance(300)
    expect(harness.eyeOffsets.length).toBe(afterPause)
  })

  it('leaves no frames armed after destroy', () => {
    const harness = createHarness()
    const avatar = harness.mountAvatar({ animation: 'idle', autoplay: false })
    harness.advance(300)
    avatar.destroy()
    expect(harness.pending()).toBe(0)
  })

  it('replaces the DOT defs instead of piling a new copy up every frame', () => {
    // Every ambient frame rebuilds the material under the same id prefix. If
    // the defs were appended rather than replaced, the document would carry one
    // more copy of every gradient each frame and url(#id) would keep resolving
    // to the very first one, so the shading would stop following the pose.
    const harness = createHarness()
    harness.mountAvatar({ animation: 'idle', autoplay: false })
    harness.advance(300)
    const afterOne = harness.dotDefsNodes()
    harness.advance(3000)
    expect(harness.blobBuilds).toBeGreaterThan(10)
    expect(harness.dotDefsNodes()).toBe(afterOne)
    // One definition, one owner: the id must exist exactly once in the document.
    expect(harness.host.querySelectorAll('#avatar-dot-volume')).toHaveLength(1)
  })

  it('still animates an avatar exported before the DOT rename', () => {
    // The runtime never parses its payload: `DATA` goes straight from JSON to
    // the geometry. So the pre-rename `blob2d` spelling has to be understood
    // here, not only in the document parser.
    const harness = createHarness({
      ...surfacePresets.softDot,
      type: 'blob2d',
      softDot: undefined,
      blob2d: { ...surfacePresets.softDot.softDot, seed: 99 },
    })
    harness.mountAvatar({ animation: 'idle', autoplay: false })
    harness.advance(600)
    expect(harness.blobBuilds).toBeGreaterThan(0)
    expect(harness.eyeOffsets.length).toBeGreaterThan(1)
    expect(harness.eyeOffsets.some(offset => offset.x !== 0)).toBe(true)
  })

  it('carries ambient eye motion into the eyes on the blob surface', () => {
    const harness = createHarness()
    harness.mountAvatar({ animation: 'idle', autoplay: false })
    harness.advance(1200)
    expect(harness.eyeOffsets.length).toBeGreaterThan(2)
    const distinct = new Set(harness.eyeOffsets.map(offset => offset.x.toFixed(4)))
    expect(distinct.size).toBeGreaterThan(1)
    expect(harness.eyeOffsets.some(offset => offset.x !== 0)).toBe(true)
  })
})
