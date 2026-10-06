/**
 * Surface field: the seam between the fork geometry and the dot material.
 *
 * The previous engine invented its own silhouette and then approximated
 * lighting from a hand-built circle. That is exactly the "generic blob"
 * failure: the material knew nothing about the geometry it was painted on.
 *
 * Here the field is derived from the *same* surface the studio already
 * projects. `projectSurfaceSample` gives the visible point and its camera
 * space normal for any (longitude, latitude) of a real `SurfaceConfig`, so:
 *
 *   - the silhouette is the projected horizon of that surface, not a circle;
 *   - the normal is the surface's own normal, so an elongated or asymmetric
 *     shape is lit as an elongated or asymmetric object (FASE 64);
 *   - perspective and head rotation are inherited, never re-derived (FASE 24).
 *
 * Everything below is a pure function of the geometry plus the seed, so the
 * field is byte-stable between the preview, the export and a later bake.
 */

import {
  projectSurfaceSample,
  type AvatarPose,
  type Point3,
  type SurfaceConfig,
} from '@bible-strong/avatar-core'

import { clamp01, fbm2D, lerp } from './blobUtils'
import type { Point2 } from './blobUtils'

/** A camera space normal plus the depth that produced it. */
export type FieldSample = {
  /** Screen position of the surface point. */
  screen: Point2
  /** Depth along the view axis, kept for the terminator test. */
  depth: number
  /** Unit normal in camera space. */
  normal: Point3
  /**
   * Normalized height above the silhouette, 0 at the horizon and 1 at the
   * facing pole. For a sphere this is exactly `sqrt(1 - r^2)`.
   */
  height: number
  /** Distance to the silhouette edge in the same normalized units. */
  edgeDistance: number
}

export type SurfaceField = {
  /** Projected horizon, in screen space, ordered counter-clockwise. */
  horizon: Point2[]
  /** Projected facing pole. */
  center: Point2
  /** Screen-space radius of the horizon along x and y. */
  radiusX: number
  radiusY: number
  /** Depth of the facing pole; the horizon sits at depth 0 by construction. */
  centerDepth: number
  /**
   * Longitudes of the visible hemisphere, with their screen radii. The normal
   * at an arbitrary screen position is interpolated from this ring, so the
   * material follows the silhouette instead of assuming a disc.
   */
  ring: { angle: number; x: number; y: number; normal: Point3 }[]
  samples: FieldSample[]
  /** Peak-to-peak curvature proxy over the visible field, 0 for a sphere. */
  curvature: number
}

/** Meridians from the limb to the pole, excluding both ends. */
const MERIDIAN_STEPS = 6
/** Resolution of the synthetic limb used when the traced one is degenerate. */
const EXTENT_SAMPLES = 24

const normalize = ([x, y, z]: Point3): Point3 => {
  const length = Math.hypot(x, y, z)
  return length < 1e-9 ? [0, 0, 1] : [x / length, y / length, z / length]
}

const distance = (left: Point2, right: Point2): number =>
  Math.hypot(left.x - right.x, left.y - right.y)

/**
 * The limb of a convex surface: the set of points whose camera normal is
 * perpendicular to the view.
 *
 * This is the same test the fork already uses to trace its own organic outline
 * (`ORGANIC_LIMB_BAND` in geometry.ts), so the dot's silhouette and the
 * avatar's silhouette are the same curve by construction. Walking a single
 * latitude instead would collapse to a point whenever the surface faces the
 * camera, which is the normal case here.
 */
const LIMB_BAND = 0.2
const LATITUDE_SAMPLES = 33
const LONGITUDE_SAMPLES = 72

/** Half-extents of a set of projected points, used to size the fallback ring. */
const boundsOf = (points: readonly { point: Point2 }[]) => {
  const xs = points.map(entry => entry.point.x)
  const ys = points.map(entry => entry.point.y)
  return {
    radiusX: (Math.max(...xs) - Math.min(...xs)) / 2,
    radiusY: (Math.max(...ys) - Math.min(...ys)) / 2,
  }
}

/**
 * Builds the field for a surface.
 *
 * `pose` carries the camera orientation and perspective, so a rotated head
 * produces a rotated field while the lights stay in camera space (FASE 23).
 */
export const buildSurfaceField = (pose: AvatarPose, surface: SurfaceConfig): SurfaceField => {
  const samples: FieldSample[] = []

  // The facing pole anchors the body: every direction is measured from it, so
  // the field stays centred on the object rather than on the origin.
  const centerSample = projectSurfaceSample(pose, surface, 0, 0)
  // A malformed surface must not poison every downstream term. The export
  // runtime feeds its raw payload straight in here without a parse step, so a
  // single NaN in the JSON would otherwise reach the path data itself.
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)
  const center: Point2 = {
    x: finite(centerSample.point[0], 0),
    y: finite(centerSample.point[1], 0),
  }
  const centerDepth = finite(centerSample.point[2], 0)

  // Sample the whole sphere once and keep the limb, exactly as the fork traces
  // its organic outline. Only finite projections can describe a limb.
  const limb: { point: Point2; normal: Point3; depth: number }[] = []
  for (let latitudeIndex = 0; latitudeIndex < LATITUDE_SAMPLES; latitudeIndex++) {
    const latitude = -Math.PI / 2 + (latitudeIndex / (LATITUDE_SAMPLES - 1)) * Math.PI
    for (let longitudeIndex = 0; longitudeIndex < LONGITUDE_SAMPLES; longitudeIndex++) {
      const longitude = -Math.PI + (longitudeIndex / (LONGITUDE_SAMPLES - 1)) * Math.PI * 2
      const sample = projectSurfaceSample(pose, surface, longitude, latitude)
      if (Math.abs(sample.normal[2]) > LIMB_BAND) continue
      if (
        !Number.isFinite(sample.point[0]) ||
        !Number.isFinite(sample.point[1]) ||
        !Number.isFinite(sample.point[2]) ||
        !sample.normal.every(Number.isFinite)
      )
        continue
      limb.push({
        point: { x: sample.point[0], y: sample.point[1] },
        normal: sample.normal,
        depth: sample.point[2],
      })
    }
  }

  // A degenerate surface (a zeroed width, for instance) still returns
  // thousands of limb points, because in this parameterization the silhouette
  // is a band rather than a curve: every longitude at the facing pole has a
  // near-zero normal z. Counting points therefore says nothing about whether
  // the silhouette is real — only how far it actually spreads does.
  //
  // The fallback rebuilds the field from that spread, and derives its normals
  // from the same soft spherical surface a traced limb would have produced: in
  // silhouette space r2 = x² + y², inside the shape z = sqrt(max(0, 1 - r2))
  // and N = normalize(x, y, z). On the limb r2 = 1, so z = 0 and the normal is
  // the silhouette's own tangent.
  const syntheticExtent = (() => {
    const nominalX = Math.abs(surface.width / 2) || 1
    const nominalY = Math.abs(surface.height / 2) || 1
    const traced = limb.length >= 8 ? boundsOf(limb) : { radiusX: 0, radiusY: 0 }
    // Under a thousandth of the nominal size is numerical noise, not a
    // silhouette. Comparing against the nominal size rather than zero matters:
    // a degenerate projection returns values that are tiny but non-zero, and a
    // plain truthiness test would happily accept them.
    const spread = Math.max(nominalX, nominalY, 1) * 1e-3
    const isReal = (value: number) => Number.isFinite(value) && value >= spread
    const usable = isReal(traced.radiusX) && isReal(traced.radiusY)
    return {
      radiusX: Math.max(1e-6, usable ? traced.radiusX : nominalX),
      radiusY: Math.max(1e-6, usable ? traced.radiusY : nominalY),
      usable,
    }
  })()
  // A flattened or zeroed surface still hands back thousands of limb points, all
  // collapsed onto a line: calling that "measured" is how a degenerate
  // silhouette used to slip past the fallback entirely.
  const measured = limb.length >= 8 && syntheticExtent.usable
  const fallbackRing = Array.from({ length: EXTENT_SAMPLES }, (_, index) => {
    const angle = -Math.PI + (index / EXTENT_SAMPLES) * Math.PI * 2
    return {
      point: {
        x: center.x + syntheticExtent.radiusX * Math.cos(angle),
        y: center.y + syntheticExtent.radiusY * Math.sin(angle),
      },
      normal: [Math.cos(angle), Math.sin(angle), 0] as Point3,
      depth: 0,
    }
  })
  const fallback: { point: Point2; normal: Point3; depth: number }[] = measured
    ? limb
    : fallbackRing

  // Ordered by screen angle, so the ring walks the silhouette exactly once.
  const ring: SurfaceField['ring'] = fallback
    .map(entry => ({
      angle: Math.atan2(entry.point.y - center.y, entry.point.x - center.x),
      x: entry.point.x,
      y: entry.point.y,
      normal: entry.normal,
    }))
    .sort((left, right) => left.angle - right.angle)
  const horizon = ring.map(entry => ({ x: entry.x, y: entry.y }))

  const minX = Math.min(...horizon.map(point => point.x))
  const maxX = Math.max(...horizon.map(point => point.x))
  const minY = Math.min(...horizon.map(point => point.y))
  const maxY = Math.max(...horizon.map(point => point.y))
  const radiusX = Math.max(1e-6, (maxX - minX) / 2)
  const radiusY = Math.max(1e-6, (maxY - minY) / 2)

  /**
   * The interior of the fallback field, walked from the limb to the pole.
   *
   * `t` runs 0 at the pole to 1 at the limb, so the normalized radius is
   * 1 - t: at the limb r2 = 1 and z = 0, at the pole r2 = 0 and z = 1. The
   * screen position is stretched by the silhouette's own aspect, which is what
   * keeps an elongated shape elongated.
   */
  const syntheticSample = (angle: number, t: number) => {
    const radius = 1 - t
    const u = Math.cos(angle)
    const v = Math.sin(angle)
    return {
      point: [
        center.x + syntheticExtent.radiusX * u * radius,
        center.y + syntheticExtent.radiusY * v * radius,
        centerDepth * (1 - radius),
      ],
      normal: [u * radius, v * radius, Math.sqrt(Math.max(0, 1 - radius * radius))] as Point3,
    }
  }

  // Every interior sample walks its own meridian from the limb to the pole, so
  // the field follows the real surface: an elongated shape yields elongated
  // normals with no extra parameter.
  for (const entry of ring) {
    for (let step = 1; step < MERIDIAN_STEPS; step++) {
      const t = step / MERIDIAN_STEPS
      // Interpolating along the meridian in spherical space keeps the normal
      // consistent; lerping two unit vectors in screen space can collapse
      // them toward the centre.
      const angle = entry.angle
      const latitude = (1 - t) * (Math.PI / 2)
      const sample = measured
        ? projectSurfaceSample(pose, surface, angle, latitude)
        : syntheticSample(angle, t)
      const screen: Point2 = { x: sample.point[0], y: sample.point[1] }
      const normalized = Math.min(1, distance(screen, center) / Math.max(radiusX, radiusY))
      samples.push({
        screen,
        depth: sample.point[2],
        normal: sample.normal,
        height: sample.normal[2] < 0 ? 0 : sample.normal[2],
        edgeDistance: clamp01(1 - normalized),
      })
    }
  }

  // Curvature proxy: how much the projected limb radius varies with angle.
  // A perfect sphere scores 0, an amoeba scores high, and the cavity term uses
  // it to darken genuinely irregular regions instead of every edge equally.
  const radii = ring.map(entry => distance({ x: entry.x, y: entry.y }, center))
  const meanRadius = radii.reduce((total, value) => total + value, 0) / Math.max(1, radii.length)
  const curvature =
    meanRadius === 0
      ? 0
      : radii.reduce((total, value) => total + Math.abs(value - meanRadius), 0) /
        Math.max(1, radii.length) /
        meanRadius

  return { horizon, center, radiusX, radiusY, centerDepth, ring, samples, curvature }
}

/**
 * Normal at an arbitrary screen position, in camera space.
 *
 * The screen direction picks a sector of the horizon ring and the normalized
 * radius picks how far up the meridian we are, so the normal is a blend of the
 * horizon normal and the pole normal. This is the shape-aware replacement for
 * the analytic `normalize(x, y, sqrt(1 - r^2))` sphere: identical for a
 * sphere, correct for everything else.
 */
export const normalAtScreenPoint = (field: SurfaceField, point: Point2): Point3 => {
  const dx = point.x - field.center.x
  const dy = point.y - field.center.y
  // Work in the field's own aspect so an elongated dot is not read as round.
  const aspect = field.radiusX / field.radiusY
  const radius = Math.hypot(dx / aspect, dy) / Math.max(field.radiusX, field.radiusY)
  const clamped = clamp01(radius)

  const angle = Math.atan2(dy, dx)
  const sector = field.ring.length || 1
  // The ring is sorted by screen angle starting at -pi, so an index derived
  // from the raw angle lands exactly opposite the direction being queried:
  // `angle = 0` (right) selected entry 0, which sits at -pi (left), and every
  // normal in the body came back flipped in-plane. The material was then lit
  // from the side the key light was not on, while the specular - which reads
  // the rig directly - stayed where it belonged, and the two fought.
  const position = (((angle + Math.PI) / (Math.PI * 2)) * sector + sector) % sector
  const lower = field.ring[Math.floor(position) % sector]
  const upper = field.ring[Math.floor(position + 1) % sector]
  const blend = position - Math.floor(position)

  const edgeNormal = normalize([
    lerp(lower.normal[0], upper.normal[0], blend),
    lerp(lower.normal[1], upper.normal[1], blend),
    lerp(lower.normal[2], upper.normal[2], blend),
  ])
  if (clamped <= 1e-6) return [0, 0, 1]

  // The pole normal is +z by construction of the visible hemisphere, so the
  // blend is a spherical interpolation from the rim towards the camera.
  const rise = Math.sqrt(Math.max(0, 1 - clamped * clamped))
  return normalize([
    edgeNormal[0] * clamped,
    edgeNormal[1] * clamped,
    edgeNormal[2] * clamped + rise * (1 - Math.abs(edgeNormal[2])),
  ])
}

/** Distance to the silhouette edge, normalized to 0..1. */
export const edgeDistanceAt = (field: SurfaceField, point: Point2): number => {
  let best = Number.POSITIVE_INFINITY
  for (const boundary of field.horizon) {
    const gap = distance(point, boundary)
    if (gap < best) best = gap
  }
  return clamp01(best / Math.max(1e-6, Math.max(field.radiusX, field.radiusY)))
}

/**
 * Deformed normal: the surface normal plus a smooth, low frequency, seeded
 * perturbation (FASE 7).
 *
 * The goal is an *imperfect* surface, not a rippled one, so the amplitude is
 * small by construction and the noise stays low frequency. The perturbation is
 * evaluated in the object's own normalized space, so it does not stretch when
 * the shape's aspect ratio changes (FASE 65).
 */
export const deformNormal = (
  normal: Point3,
  point: Point2,
  field: SurfaceField,
  seed: number,
  strength: number
): Point3 => {
  if (strength <= 0) return normal
  const u = (point.x - field.center.x) / Math.max(1e-6, field.radiusX)
  const v = (point.y - field.center.y) / Math.max(1e-6, field.radiusY)
  const dx = (fbm2D(u * 1.6 + 7.3, v * 1.6 - 2.1, seed, 2) - 0.5) * 2
  const dy = (fbm2D(u * 1.6 - 4.7, v * 1.6 + 9.2, seed + 613, 2) - 0.5) * 2
  const dz = (fbm2D(u * 1.6 + 1.3, v * 1.6 + 5.6, seed + 1229, 2) - 0.5) * 2
  return normalize([
    normal[0] + dx * strength,
    normal[1] + dy * strength,
    normal[2] + dz * strength * 0.5,
  ])
}

/**
 * Multi-band surface variation, sampled in the object's local space.
 *
 * `macro` is the barely-visible tonal drift that stops the material from
 * looking printed, `micro` is the high frequency break of digital perfection.
 * Both are returned in -1..1 so the caller decides the amplitude: the field
 * describes the surface, the material decides how loud it is (FASE 61).
 */
export const sampleSurfaceVariation = (
  point: Point2,
  field: SurfaceField,
  seed: number
): { macro: number; micro: number } => {
  const u = (point.x - field.center.x) / Math.max(1e-6, field.radiusX)
  const v = (point.y - field.center.y) / Math.max(1e-6, field.radiusY)
  const macro = 0.7 * (fbm2D(u * 1.1 + 3.2, v * 1.1 - 8.4, seed + 31, 2) - 0.5)
  const macroMid = 0.3 * (fbm2D(u * 2.3 - 5.1, v * 2.3 + 2.7, seed + 97, 2) - 0.5)
  return {
    macro: (macro + macroMid) * 2,
    micro: (fbm2D(u * 9.5 + 1.7, v * 9.5 + 6.3, seed + 419, 2) - 0.5) * 2,
  }
}
