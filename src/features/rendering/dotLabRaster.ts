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

/** Rasterization edge in pixels; big enough for stable statistics, small
 * enough that measuring a 64-cell grid stays well under a second. */
const RASTER_SIZE = 160

/** Resolves to null when the cell cannot be rasterized at all. */
export const rasterizeSvg = (svg: SVGSVGElement): Promise<DotMetrics | null> =>
  new Promise(resolve => {
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('width', String(RASTER_SIZE))
    clone.setAttribute('height', String(RASTER_SIZE))

    const markup = new XMLSerializer().serializeToString(clone)
    const image = new Image()
    image.decoding = 'sync'

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = RASTER_SIZE
        canvas.height = RASTER_SIZE
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return resolve(null)
        context.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE)
        context.drawImage(image, 0, 0, RASTER_SIZE, RASTER_SIZE)
        const pixels = context.getImageData(0, 0, RASTER_SIZE, RASTER_SIZE).data
        resolve(measurePixels(pixels, RASTER_SIZE, RASTER_SIZE))
      } catch {
        resolve(null)
      }
    }

    image.onerror = () => resolve(null)
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  })

/** Rasterizes a set of cells, skipping any that fail, in order. */
export const rasterizeAll = async (svgs: SVGSVGElement[]): Promise<DotMetrics[]> => {
  const results: DotMetrics[] = []
  for (const svg of svgs) {
    const metric = await rasterizeSvg(svg)
    if (metric && metric.samples > 0) results.push(metric)
  }
  return results
}
