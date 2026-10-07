/**
 * WebGL2 column of the DOT MATERIAL LAB (browser half, React-free).
 *
 * The grid is four shapes by sixteen materials by two lights: 128 cells. A
 * WebGL context per cell is not an option — browsers keep roughly a dozen
 * live contexts and evict the oldest, which would silently turn the bottom
 * of the grid into black squares *during* a measurement run. So the column
 * owns exactly one context on a detached canvas and blits each cell into a
 * plain 2D canvas, which has no limit and can be read back directly by the
 * oracle (`readRasterCanvas`).
 *
 * Every cell renders at `LAB_RASTER_SIZE` — the same edge the SVG slots are
 * rasterized at — because `texture` is a per-neighbour difference and slots
 * measured at different resolutions are not comparable numbers.
 *
 * The uniform packing is `packBlobWebgl2Uniforms`, the very function the
 * studio's live canvas uses: same config, same light rig, same noise. What
 * this column shows is what ships, measured the same way as everything else.
 */

import type { AvatarTextureConfig } from '@bible-strong/avatar-core'

import {
  createBlobWebgl2,
  hasWebgl2,
  packBlobWebgl2Uniforms,
  type BlobWebgl2Handle,
} from './blob/blobWebgl2'
import type { BlobConfig } from './blob/blobTypes'
import { LAB_RASTER_SIZE } from './dotLabRaster'

/** `undefined` = not tried yet; null = tried and unavailable. */
let renderer: BlobWebgl2Handle | null | undefined
let source: HTMLCanvasElement | null = null

const sharedRenderer = (): BlobWebgl2Handle | null => {
  if (renderer !== undefined) return renderer
  if (!hasWebgl2()) {
    renderer = null
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = LAB_RASTER_SIZE
  canvas.height = LAB_RASTER_SIZE
  renderer = createBlobWebgl2(canvas)
  source = renderer ? canvas : null
  return renderer
}

/** The plush nap mapping the studio adapter applies, kept identical here. */
const tintFor = (
  texture: AvatarTextureConfig | undefined
): { color: string; amount: number } | null =>
  texture && texture.type === 'plush' ? { color: texture.tint ?? '', amount: 0.9 } : null

/**
 * Renders one cell's config through the shared context and blits it into
 * `target`, a 2D canvas sized `LAB_RASTER_SIZE`. Returns false when WebGL2
 * is unavailable or the target cannot be drawn; the caller then shows the
 * cell as unmeasurable rather than as a number.
 */
export const renderLabWebglCell = (
  config: BlobConfig,
  target: HTMLCanvasElement,
  texture?: AvatarTextureConfig
): boolean => {
  const gl = sharedRenderer()
  if (!gl || !source) return false
  const uniforms = packBlobWebgl2Uniforms({
    // Motion is off in the lab (a grid of moving dots is a slideshow), so
    // the pack's identity default is the still frame the SVG slots show.
    config,
    tint: tintFor(texture),
    size: { width: LAB_RASTER_SIZE, height: LAB_RASTER_SIZE },
  })
  gl.render(uniforms, LAB_RASTER_SIZE, LAB_RASTER_SIZE)
  if (target.width !== LAB_RASTER_SIZE) target.width = LAB_RASTER_SIZE
  if (target.height !== LAB_RASTER_SIZE) target.height = LAB_RASTER_SIZE
  const context = target.getContext('2d')
  if (!context) return false
  context.clearRect(0, 0, LAB_RASTER_SIZE, LAB_RASTER_SIZE)
  // `preserveDrawingBuffer` is on, and the blit happens in the same task as
  // the draw, so the source buffer is intact here.
  context.drawImage(source, 0, 0, LAB_RASTER_SIZE, LAB_RASTER_SIZE)
  return true
}

/**
 * Releases the shared context. The lab page calls it on unmount; the next
 * cell recreates the context lazily, so a hash-navigation round trip costs
 * one context, not one per visit.
 */
export const disposeLabWebgl = (): void => {
  renderer?.dispose()
  renderer = undefined
  source = null
}
