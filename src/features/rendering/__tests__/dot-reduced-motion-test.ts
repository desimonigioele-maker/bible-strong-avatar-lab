import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasWebgl2, prefersReducedMotion } from '@/features/rendering/blob/blobWebgl2'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dot renderer reduced motion', () => {
  it('returns false without a DOM, true only when the media query matches', () => {
    // vitest runs in node: no window at all.
    expect(prefersReducedMotion()).toBe(false)

    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    expect(prefersReducedMotion()).toBe(true)

    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    expect(prefersReducedMotion()).toBe(false)

    // A window without matchMedia (older embedded webviews) must degrade to
    // animating, never to a crash.
    vi.stubGlobal('window', {})
    expect(prefersReducedMotion()).toBe(false)
  })

  it('reports no WebGL2 without a DOM, so the adapter falls back to SVG', () => {
    expect(hasWebgl2()).toBe(false)
  })

  it('wires the renderer-level gate into the live adapter and the impostor', () => {
    // CSS media queries cannot reach a rAF loop, so the gate must live in the
    // renderers themselves. This pins the wiring; the freeze behavior is the
    // uniform write the loop performs when the gate is on.
    const read = (relative: string) =>
      readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    const canvas = read('../components/DotWebglCanvas.tsx')
    const webgl = read('../blob/blobWebgl2.ts')
    expect(canvas).toContain('prefersReducedMotion()')
    expect(canvas).toContain('prefersReducedMotion() ? 0 :')
    expect(webgl).toContain('prefers-reduced-motion')
  })

  it('keeps the WebGL2 path free of Three.js and React state per frame', () => {
    const read = (relative: string) =>
      readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
    const canvas = read('../components/DotWebglCanvas.tsx')
    const webgl = read('../blob/blobWebgl2.ts')
    expect(webgl).not.toContain("from 'three'")
    expect(canvas).not.toContain("from 'three'")
    expect(webgl).not.toContain('Math.random')
    // The animation loop reads props through a ref; the only state is the
    // one-time capability fallback (counted at call sites, not the import).
    expect((canvas.match(/useState\(/g) ?? []).length).toBe(1)
    expect(canvas).not.toContain('useMemo')
    expect(canvas).not.toContain('useCallback')
  })
})
