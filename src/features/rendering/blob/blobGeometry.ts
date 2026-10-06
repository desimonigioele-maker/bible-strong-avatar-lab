/**
 * Procedural silhouette generation (FASI 2, 14, 43).
 *
 * Shape noise and surface noise are deliberately kept apart: this module owns
 * the outline only. The outline uses a low-frequency mass term, an optional
 * lobe term and a barely-visible micro deformation; everything finer than that
 * belongs to `blobSurface.ts` and must never reach the silhouette, otherwise
 * the shape reads as jittery rather than organic.
 */

import {
  blobShapeFamilies,
  type BlobConfig,
  type BlobShapeConfig,
  type BlobShapeFamily,
} from './blobTypes'
import { clamp01, closedCatmullRomPath, fbm2D, lerp, mulberry32, type Point2 } from './blobUtils'

export type BlobBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export type BlobGeometry = {
  /** Outline samples in user space, already rotated and normalized. */
  points: Point2[]
  /** Closed cubic Bezier path, ready for `d`. */
  path: string
  /** Offset of the centroid from the origin; lighting anchors onto this. */
  center: Point2
  /** Mean radius used to normalize the outline. */
  radius: number
  bounds: BlobBounds
}

/** Base tuning per family. Selecting a family swaps these in, then you refine. */
export const blobShapePresets: Record<BlobShapeFamily, BlobShapeConfig> = {
  round: {
    family: 'round',
    seed: 918273,
    pointCount: 96,
    radius: 108,
    irregularity: 0.32,
    asymmetry: 0.12,
    elongationX: 1.02,
    elongationY: 0.97,
    rotation: -6,
    smoothness: 0.92,
    lobeCount: 3,
    lobeStrength: 0.08,
    deformationFrequency: 2.2,
    deformationAmplitude: 0.06,
  },
  elongated: {
    family: 'elongated',
    seed: 918273,
    pointCount: 112,
    radius: 104,
    irregularity: 0.28,
    asymmetry: 0.08,
    elongationX: 1.32,
    elongationY: 0.7,
    rotation: 0,
    smoothness: 0.95,
    lobeCount: 2,
    lobeStrength: 0.05,
    deformationFrequency: 2,
    deformationAmplitude: 0.05,
  },
  compressed: {
    family: 'compressed',
    seed: 918273,
    pointCount: 96,
    radius: 112,
    irregularity: 0.3,
    asymmetry: 0.1,
    elongationX: 1.18,
    elongationY: 0.62,
    rotation: 0,
    smoothness: 0.9,
    lobeCount: 3,
    lobeStrength: 0.12,
    deformationFrequency: 2.4,
    deformationAmplitude: 0.06,
  },
  asymmetric: {
    family: 'asymmetric',
    seed: 918273,
    pointCount: 96,
    radius: 108,
    irregularity: 0.34,
    asymmetry: 0.46,
    elongationX: 1.06,
    elongationY: 0.96,
    rotation: 0,
    smoothness: 0.9,
    lobeCount: 3,
    lobeStrength: 0.14,
    deformationFrequency: 2.2,
    deformationAmplitude: 0.07,
  },
  doubleLobe: {
    family: 'doubleLobe',
    seed: 918273,
    pointCount: 128,
    radius: 100,
    irregularity: 0.24,
    asymmetry: 0.14,
    elongationX: 1.16,
    elongationY: 1,
    rotation: 0,
    smoothness: 0.96,
    lobeCount: 2,
    lobeStrength: 0.34,
    deformationFrequency: 2,
    deformationAmplitude: 0.05,
  },
  roundedSquare: {
    family: 'roundedSquare',
    seed: 918273,
    pointCount: 96,
    radius: 108,
    irregularity: 0.12,
    asymmetry: 0.06,
    elongationX: 1,
    elongationY: 1,
    rotation: 0,
    smoothness: 0.78,
    lobeCount: 4,
    lobeStrength: 0.26,
    deformationFrequency: 1.6,
    deformationAmplitude: 0.03,
  },
  bean: {
    family: 'bean',
    seed: 918273,
    pointCount: 120,
    radius: 102,
    irregularity: 0.2,
    asymmetry: 0.52,
    elongationX: 1.24,
    elongationY: 0.84,
    rotation: -12,
    smoothness: 0.94,
    lobeCount: 2,
    lobeStrength: 0.3,
    deformationFrequency: 2.2,
    deformationAmplitude: 0.06,
  },
  amoeba: {
    family: 'amoeba',
    seed: 918273,
    pointCount: 128,
    radius: 108,
    irregularity: 0.58,
    asymmetry: 0.3,
    elongationX: 1.04,
    elongationY: 0.98,
    rotation: 0,
    smoothness: 0.95,
    lobeCount: 7,
    lobeStrength: 0.3,
    deformationFrequency: 3.2,
    deformationAmplitude: 0.1,
  },
  pill: {
    family: 'pill',
    seed: 918273,
    pointCount: 96,
    radius: 104,
    irregularity: 0.1,
    asymmetry: 0.04,
    elongationX: 1.5,
    elongationY: 0.62,
    rotation: 0,
    smoothness: 0.97,
    lobeCount: 2,
    lobeStrength: 0.02,
    deformationFrequency: 1.4,
    deformationAmplitude: 0.02,
  },
  capsule: {
    family: 'capsule',
    seed: 918273,
    pointCount: 112,
    radius: 100,
    irregularity: 0.08,
    asymmetry: 0.03,
    elongationX: 1.72,
    elongationY: 0.5,
    rotation: -8,
    smoothness: 0.98,
    lobeCount: 2,
    lobeStrength: 0.01,
    deformationFrequency: 1.2,
    deformationAmplitude: 0.02,
  },
  puddle: {
    family: 'puddle',
    seed: 918273,
    pointCount: 96,
    radius: 114,
    irregularity: 0.26,
    asymmetry: 0.12,
    elongationX: 1.12,
    elongationY: 0.5,
    rotation: 0,
    smoothness: 0.88,
    lobeCount: 5,
    lobeStrength: 0.16,
    deformationFrequency: 2.6,
    deformationAmplitude: 0.07,
  },
  triangle: {
    family: 'triangle',
    seed: 918273,
    pointCount: 96,
    radius: 108,
    irregularity: 0.14,
    asymmetry: 0.08,
    elongationX: 1.04,
    elongationY: 0.98,
    rotation: 0,
    smoothness: 0.82,
    lobeCount: 3,
    lobeStrength: 0.42,
    deformationFrequency: 1.8,
    deformationAmplitude: 0.04,
  },
  diamond: {
    family: 'diamond',
    seed: 918273,
    pointCount: 96,
    radius: 108,
    irregularity: 0.12,
    asymmetry: 0.06,
    elongationX: 1,
    elongationY: 1,
    rotation: 0,
    smoothness: 0.8,
    lobeCount: 4,
    lobeStrength: 0.36,
    deformationFrequency: 1.6,
    deformationAmplitude: 0.04,
  },
  cloud: {
    family: 'cloud',
    seed: 918273,
    pointCount: 144,
    radius: 104,
    irregularity: 0.16,
    asymmetry: 0.08,
    elongationX: 1.14,
    elongationY: 0.88,
    rotation: 0,
    smoothness: 0.96,
    lobeCount: 9,
    lobeStrength: 0.26,
    deformationFrequency: 2,
    deformationAmplitude: 0.05,
  },
}

export const blobShapeFamilyList: BlobShapeFamily[] = [...blobShapeFamilies]

/**
 * Swaps the shape sub-config for a family preset while keeping the current
 * seed, so "pick a silhouette, keep my variation" behaves as expected.
 */
export const applyBlobShapeFamily = (config: BlobConfig, family: BlobShapeFamily): BlobConfig => ({
  ...config,
  shape: { ...blobShapePresets[family], seed: config.shape.seed },
})

/**
 * Samples the outline.
 *
 * Three separated frequency bands keep the silhouette clean:
 * - mass (fbm, 3 octaves) sets the overall organic swell;
 * - lobes (a cosine harmonic) creates deliberate bumps such as bean or cloud;
 * - micro (fbm at `deformationFrequency`) stays under `deformationAmplitude`
 *   so it reads as surface life rather than noise.
 */
/**
 * A shrunken copy of the outline, used for cavity and edge shading.
 *
 * Because the inset follows the silhouette, it automatically hugs concave
 * regions harder than convex ones: no separate curvature analysis is needed
 * for the cavity term to look right (FASI 8, 54).
 */
export const buildBlobInsetPath = (geometry: BlobGeometry, factor: number, tension = 1): string => {
  const scale = clamp01(factor)
  const inset = geometry.points.map(point => ({
    x: geometry.center.x + (point.x - geometry.center.x) * scale,
    y: geometry.center.y + (point.y - geometry.center.y) * scale,
  }))
  return closedCatmullRomPath(inset, tension)
}

export const buildBlobGeometry = (shape: BlobShapeConfig): BlobGeometry => {
  const random = mulberry32(shape.seed)
  // Two random phases keep the asymmetry term from lining up with the lobes.
  const lobePhase = random() * Math.PI * 2
  const asymPhase = random() * Math.PI * 2
  const rotationRadians = (shape.rotation * Math.PI) / 180
  const cosRotation = Math.cos(rotationRadians)
  const sinRotation = Math.sin(rotationRadians)

  const raw: { point: Point2; angle: number }[] = []
  let meanRadius = 0

  for (let index = 0; index < shape.pointCount; index++) {
    const angle = (index / shape.pointCount) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    // Sampling noise on the unit circle keeps the field seamless at the seam.
    const mass = fbm2D(cos * 0.6 + 11.3, sin * 0.6 + 4.7, shape.seed, 3) - 0.5
    const micro =
      fbm2D(
        cos * shape.deformationFrequency * 2 + 31.7,
        sin * shape.deformationFrequency * 2 + 19.1,
        shape.seed + 977,
        2
      ) - 0.5

    let radius = shape.radius
    radius *= 1 + mass * 2 * shape.irregularity * 0.34
    radius *= 1 + Math.cos(shape.lobeCount * angle + lobePhase) * shape.lobeStrength * 0.2
    radius *= 1 + Math.sin(angle * 2 + asymPhase) * shape.asymmetry * 0.13
    radius += shape.radius * micro * 2 * shape.deformationAmplitude * 0.14

    const point = {
      x: cos * radius * shape.elongationX,
      y: sin * radius * shape.elongationY,
    }
    meanRadius += Math.hypot(point.x, point.y)
    raw.push({
      point: {
        x: point.x * cosRotation - point.y * sinRotation,
        y: point.x * sinRotation + point.y * cosRotation,
      },
      angle,
    })
  }

  meanRadius /= Math.max(1, raw.length)
  // Normalize on the mean radius so elongation grows the shape instead of
  // silently shrinking it.
  const scale = meanRadius === 0 ? 1 : shape.radius / meanRadius

  const points = raw.map(entry => ({ x: entry.point.x * scale, y: entry.point.y * scale }))
  const bounds = points.reduce<BlobBounds>(
    (accumulator, point) => ({
      minX: Math.min(accumulator.minX, point.x),
      minY: Math.min(accumulator.minY, point.y),
      maxX: Math.max(accumulator.maxX, point.x),
      maxY: Math.max(accumulator.maxY, point.y),
      width: 0,
      height: 0,
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, width: 0, height: 0 }
  )
  bounds.width = bounds.maxX - bounds.minX
  bounds.height = bounds.maxY - bounds.minY

  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }

  return {
    points,
    path: closedCatmullRomPath(points, lerp(0.15, 1, clamp01(shape.smoothness))),
    center,
    radius: shape.radius,
    bounds,
  }
}
