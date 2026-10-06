/**
 * Debug overlay (FASI 43).
 *
 * The shading model has too many terms to be trusted by eye from a thumbnail,
 * and the failure mode — a flat, washed-out body — is invisible in a single
 * screenshot. These overlays expose each term of the pipeline on its own, so a
 * regression names itself: no normals means a degenerate field, a specular
 * stuck at the centre means the half vector is wrong, a cavity ringing the
 * whole edge means the AO is too strong.
 *
 * Nothing here is on in a production render. It is emitted only when
 * `BlobSvgOptions.debug` asks for it, and the markup is inert: no blend modes,
 * no filters, only strokes and markers.
 */

import type { BlobLightingDefinition, GradientStop, LinearLayer } from './blobLighting'
import type { BlobGeometry } from './blobGeometry'
import type { SurfaceField } from './blobSurfaceField'
import { format } from './blobUtils'
import type { Point2 } from './blobUtils'

export const blobDebugFlags = [
  'silhouette',
  'center',
  'normals',
  'lights',
  'cavity',
  'noise',
  'bounds',
  'seed',
] as const

export type BlobDebugFlag = (typeof blobDebugFlags)[number]

export type BlobDebugOverlay = {
  flags: BlobDebugFlag[]
  markup: string
}

const crosshair = (point: Point2, size: number, color: string): string =>
  `<path d="M ${format(point.x - size)} ${format(point.y)} H ${format(point.x + size)}` +
  ` M ${format(point.x)} ${format(point.y - size)} V ${format(point.y + size)}"` +
  ` fill="none" stroke="${color}" stroke-width="1"/>` +
  `<circle cx="${format(point.x)}" cy="${format(point.y)}" r="${format(size * 0.4)}"` +
  ` fill="none" stroke="${color}" stroke-width="1"/>`

/**
 * Draws the surface normals as short segments.
 *
 * Only a subsample is drawn: the full field is several hundred vectors and
 * would be a black disc, which tells you nothing. Every eighth meridian sample
 * is enough to see the field turning and collapsing.
 */
const normalSegments = (field: SurfaceField, radius: number, color: string): string => {
  const parts: string[] = []
  field.samples.forEach((sample, index) => {
    if (index % 8 !== 0) return
    const length = radius * 0.16
    // The normal points into the camera, so it is drawn foreshortened: a full
    // length arrow would leave the silhouette and read as a lighting error.
    parts.push(
      `<path d="M ${format(sample.screen.x)} ${format(sample.screen.y)}` +
        ` L ${format(sample.screen.x + sample.normal[0] * length)}` +
        ` ${format(sample.screen.y + sample.normal[1] * length)}"` +
        ` stroke="${color}" stroke-width="1" fill="none"/>`
    )
  })
  return parts.join('')
}

/** Light markers placed at their real distance, projected to screen. */
const lightMarkers = (lighting: BlobLightingDefinition, radius: number): string => {
  const entries: { name: string; position: { x: number; y: number; z: number }; color: string }[] =
    [
      { name: 'key', position: lighting.rig.key.position, color: '#ffd23f' },
      { name: 'fill', position: lighting.rig.fill.position, color: '#5ec8ff' },
      { name: 'rim', position: lighting.rig.rim.position, color: '#ff7ae0' },
    ]
  return entries
    .map(entry => {
      // A light in front of the body (z > 0) draws in front of it, one behind
      // draws dashed: the sign of z is the whole reason the rim only reaches
      // the edges, and the overlay has to show that.
      const inFront = entry.position.z >= 0
      const x = lighting.volume.x1 + (lighting.volume.x2 - lighting.volume.x1) * 0.5
      const y = lighting.volume.y1 + (lighting.volume.y2 - lighting.volume.y1) * 0.5
      const scale = radius * 0.1
      return (
        `<g data-debug-light="${entry.name}">` +
        `<circle cx="${format(x + entry.position.x * scale)}"` +
        ` cy="${format(y + entry.position.y * scale)}" r="4"` +
        ` fill="${entry.color}" fill-opacity="${inFront ? 0.95 : 0.35}"` +
        ` stroke="${entry.color}" stroke-width="1"` +
        `${inFront ? '' : ' stroke-dasharray="2 2"'}/>` +
        `</g>`
      )
    })
    .join('')
}

/** The gradient axis of the body ramp, so its direction is unambiguous. */
const rampAxis = (layer: LinearLayer, color: string): string =>
  `<path d="M ${format(layer.x1)} ${format(layer.y1)} L ${format(layer.x2)} ${format(layer.y2)}"` +
  ` stroke="${color}" stroke-width="1" stroke-dasharray="4 3" fill="none"/>` +
  `<circle cx="${format(layer.x1)}" cy="${format(layer.y1)}" r="3" fill="${color}"/>` +
  `<circle cx="${format(layer.x2)}" cy="${format(layer.y2)}" r="3" fill="none" stroke="${color}" stroke-width="1"/>`

/**
 * Builds the overlay.
 *
 * `stops` is passed in rather than recomputed so the overlay and the render
 * can never disagree about what was actually emitted.
 */
export const buildBlobDebugOverlay = (input: {
  flags: BlobDebugFlag[]
  geometry: BlobGeometry
  field: SurfaceField
  lighting: BlobLightingDefinition
  stops: GradientStop[]
  seed: number
}): BlobDebugOverlay => {
  const { geometry, field, lighting, stops } = input
  const active = new Set(input.flags)
  const radius = Math.max(geometry.radius, 1)
  const parts: string[] = []

  if (active.has('silhouette')) {
    parts.push(
      `<path d="${geometry.path}" fill="none" stroke="#00ff88" stroke-width="1.5"` +
        ' stroke-dasharray="6 3"/>'
    )
    // The inset the cavity and rim actually use, so their real geometry is
    // visible rather than their intended one.
    parts.push(
      `<path d="${geometry.path}" fill="none" stroke="#00ff88" stroke-width="0.5"` +
        ' stroke-opacity="0.4" transform="scale(0.87)"/>'
    )
  }

  if (active.has('bounds')) {
    const { bounds } = geometry
    parts.push(
      `<rect x="${format(bounds.minX)}" y="${format(bounds.minY)}"` +
        ` width="${format(bounds.width)}" height="${format(bounds.height)}"` +
        ' fill="none" stroke="#ffffff" stroke-width="0.75" stroke-dasharray="2 2"/>'
    )
  }

  if (active.has('center')) {
    parts.push(crosshair(field.center, radius * 0.16, '#ff4f4f'))
    parts.push(
      `<text x="${format(field.center.x + radius * 0.2)}"` +
        ` y="${format(field.center.y)}" fill="#ff4f4f" font-size="9"` +
        ` font-family="monospace">r ${format(field.radiusX)}x${format(field.radiusY)}` +
        ` c ${format(field.curvature)}</text>`
    )
  }

  if (active.has('normals')) {
    parts.push(normalSegments(field, radius, '#7cff6b'))
  }

  if (active.has('lights')) {
    parts.push(lightMarkers(lighting, radius))
    parts.push(rampAxis(lighting.volume, '#ffd23f'))
  }

  if (active.has('cavity')) {
    // The cavity is a radial falloff from the edge, so it is drawn as the
    // iso-contours of edge distance that actually drive it.
    for (const level of [0.25, 0.5, 0.75]) {
      parts.push(
        `<path d="${geometry.path}" fill="none" stroke="#ff9d3f"` +
          ` stroke-width="0.75" stroke-opacity="0.7" transform="scale(${format(1 - level * 0.3)})"/>`
      )
    }
  }

  if (active.has('noise')) {
    // The sampled stops, in ramp order, as a strip along the axis.
    stops.forEach((stop, index) => {
      const t = index / Math.max(1, stops.length - 1)
      const x = lighting.volume.x1 + (lighting.volume.x2 - lighting.volume.x1) * t
      const y = lighting.volume.y1 + (lighting.volume.y2 - lighting.volume.y1) * t
      parts.push(
        `<rect x="${format(x - 3)}" y="${format(y - 3)}" width="6" height="6"` +
          ` fill="${stop.color}" stroke="#000000" stroke-width="0.5"/>`
      )
    })
  }

  if (active.has('seed')) {
    parts.push(
      `<text x="${format(field.center.x - radius)}" y="${format(field.center.y - radius * 0.9)}"` +
        ` fill="#ffffff" font-size="11" font-family="monospace">seed ${input.seed}</text>`
    )
  }

  return {
    flags: input.flags,
    markup: parts.length
      ? `<g data-blob-debug="${input.flags.join(' ')}" pointer-events="none">${parts.join('')}</g>`
      : '',
  }
}
