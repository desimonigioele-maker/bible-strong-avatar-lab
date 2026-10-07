/**
 * Browser half of the DOT MATERIAL LAB oracle (FASE A).
 *
 * `dotLabMetrics.ts` is pure pixel arithmetic so it can be tested without a
 * DOM. This file is the part that unavoidably needs a browser: serialize the
 * live SVG, rasterize it through an offscreen canvas, hand the pixels to the
 * pure functions. Keeping the split explicit is what lets the same thresholds
 * be asserted in a unit test and read off the lab page.
 *
 * Rasterization is asynchronous because image decoding is, and the lab
 * measures dozens of cells: failures are swallowed per cell rather than
 * rejecting the whole batch, so one unreadable cell never blanks the report.
 */

import { measurePixels, type DotMetrics } from './dotLabMetrics'

/**
 * Rasterization edge in pixels; big enough for stable statistics, small
 * enough that measuring a 64-cell grid stays well under a second.
 *
 * Exported because the WebGL2 column renders its cells at exactly this size:
 * `texture` is a per-neighbour difference, so two slots measured at different
 * resolutions are not comparable numbers, and the whole point of a column is
 * comparison.
 */
export const LAB_RASTER_SIZE = 160

/** Resolves to null when the cell cannot be rasterized at all. */
export const rasterizeSvg = (svg: SVGSVGElement): Promise<DotMetrics | null> =>
  new Promise(resolve => {
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(LAB_RASTER_SIZE))
    clone.setAttribute('height', String(LAB_RASTER_SIZE))

    const markup = new XMLSerializer().serializeToString(clone)
    const image = new Image()
    image.decoding = 'sync'

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = LAB_RASTER_SIZE
        canvas.height = LAB_RASTER_SIZE
        // No `willReadFrequently` here on purpose: the hint switches the
        // canvas onto the CPU backend, whose rounding on antialiased and
        // blended pixels measurably shifts `texture` on *identical* input
        // (field 3.44 vs 3.54, per-pixel 6.04 vs 5.31, measured). The
        // acceptance numbers in docs/blob-rendering.md and the static
        // gallery were calibrated on the default backend, so the lab must
        // read back through it too or the two oracles disagree by artifact.
        const context = canvas.getContext('2d')
        if (!context) return resolve(null)
        context.clearRect(0, 0, LAB_RASTER_SIZE, LAB_RASTER_SIZE)
        context.drawImage(image, 0, 0, LAB_RASTER_SIZE, LAB_RASTER_SIZE)
        const pixels = context.getImageData(0, 0, LAB_RASTER_SIZE, LAB_RASTER_SIZE).data
        resolve(measurePixels(pixels, LAB_RASTER_SIZE, LAB_RASTER_SIZE))
      } catch {
        resolve(null)
      }
    }

    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })

/**
 * Measures a live 2D canvas — the WebGL2 column's cell.
 *
 * Unlike the SVG path there is nothing to re-rasterize: the cell already
 * *is* pixels, at the same `LAB_RASTER_SIZE` the SVG slots are measured at,
 * so both slots feed `measurePixels` at comparable resolution. Null when the
 * canvas cannot be read (no 2D context, zero-sized); the caller skips the
 * cell the same way it skips an unreadable SVG.
 */
export const readRasterCanvas = (canvas: HTMLCanvasElement): DotMetrics | null => {
  if (canvas.width === 0 || canvas.height === 0) return null
  try {
    // Same backend rule as `rasterizeSvg`: the cell's context is created
    // plain by the blit (first call wins), and this must not be the call
    // that flips the canvas onto the CPU backend mid-measurement.
    const context = canvas.getContext('2d')
    if (!context) return null
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    return measurePixels(pixels, canvas.width, canvas.height)
  } catch {
    return null
  }
}

/** Rasterizes a set of cells, skipping any that fail, in order. */
export const rasterizeAll = async (svgs: SVGSVGElement[]): Promise<DotMetrics[]> => {
  const results: DotMetrics[] = []
  for (const svg of svgs) {
    const metric = await rasterizeSvg(svg)
    if (metric && metric.samples > 0) results.push(metric)
  }
  return results
}
