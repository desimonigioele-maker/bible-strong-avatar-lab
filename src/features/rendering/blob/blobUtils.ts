/**
 * Deterministic numeric helpers for the blob engine.
 *
 * Everything random-looking in this engine is a pure function of an integer
 * seed (FASI 20, 28): no `Math.random`, no module-level mutable state, so two
 * renders of the same config produce byte-identical markup.
 */

export type Point2 = { x: number; y: number }

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value

export const clamp01 = (value: number): number => clamp(Number.isFinite(value) ? value : 0, 0, 1)

/** Coerces anything to a finite number; the renderer never sees NaN. */
export const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export const clampRange = (value: unknown, min: number, max: number, fallback: number): number =>
  clamp(finiteNumber(value, fallback), min, max)

/**
 * Seeds stay non-negative integers so they can key the lattice hash, be
 * serialized to JSON and survive a round trip unchanged.
 */
export const normalizeSeed = (value: unknown): number => {
  const numeric = finiteNumber(value, 0)
  const truncated = Math.trunc(numeric)
  return ((truncated % 2147483647) + 2147483647) % 2147483647
}

/** Fixed-decimal formatting keeps generated markup stable across engines. */
export const format = (value: number): string => {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Mulberry32: 32-bit state, fast, and good enough for surface variation. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = normalizeSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer lattice hash (variant of the 32-bit finalizer from MurmurHash3). */
const hashLattice = (x: number, y: number, seed: number): number => {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Quintic fade: C2 continuous, so fbm octaves never show a crease. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

/** Bilinear value noise in 0..1. */
export const valueNoise2D = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = fade(x - x0)
  const ty = fade(y - y0)
  const s = normalizeSeed(seed)
  const v00 = hashLattice(x0, y0, s)
  const v10 = hashLattice(x0 + 1, y0, s)
  const v01 = hashLattice(x0, y0 + 1, s)
  const v11 = hashLattice(x0 + 1, y0 + 1, s)
  const top = v00 + (v10 - v00) * tx
  const bottom = v01 + (v11 - v01) * tx
  return top + (bottom - top) * ty
}

/**
 * Fractal Brownian motion, normalized back to 0..1. Used for the silhouette
 * mass (3 octaves) and, at lower amplitude, for the outline micro deformation.
 */
export const fbm2D = (x: number, y: number, seed: number, octaves = 3): number => {
  const count = Math.max(1, Math.min(8, Math.round(octaves)))
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let total = 0
  for (let octave = 0; octave < count; octave++) {
    sum += valueNoise2D(x * frequency, y * frequency, seed + octave * 1013) * amplitude
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }
  return total === 0 ? 0.5 : sum / total
}

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t

export const polarPoint = (angle: number, radius: number): Point2 => ({
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius,
})

/**
 * Closed Catmull-Rom through `points`, emitted as cubic Beziers.
 *
 * `tension` is the single knob behind `smoothness`: at 0 every segment
 * degenerates into a straight chord (visible polygon), at 1 the curve is a
 * uniform Catmull-Rom spline. This is what keeps the outline free of cusps and
 * micro-spikes that a random per-point jitter would produce.
 */
export const closedCatmullRomPath = (points: Point2[], tension = 1): string => {
  const count = points.length
  if (count < 3) return ''
  const t = clamp(tension, 0, 1)
  const at = (index: number) => points[((index % count) + count) % count]
  let d = `M ${format(points[0].x)} ${format(points[0].y)}`
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1.x + ((p2.x - p0.x) / 6) * t
    const c1y = p1.y + ((p2.y - p0.y) / 6) * t
    const c2x = p2.x - ((p3.x - p1.x) / 6) * t
    const c2y = p2.y - ((p3.y - p1.y) / 6) * t
    d += ` C ${format(c1x)} ${format(c1y)}, ${format(c2x)} ${format(c2y)}, ${format(p2.x)} ${format(p2.y)}`
  }
  return `${d} Z`
}

/** Quadratic arc used for mouths; kept here so every path stays formatted the same. */
export const smilePath = (cx: number, cy: number, width: number, curve: number): string => {
  const half = width / 2
  return (
    `M ${format(cx - half)} ${format(cy)} ` +
    `Q ${format(cx)} ${format(cy + curve * 2)} ${format(cx + half)} ${format(cy)}`
  )
}
