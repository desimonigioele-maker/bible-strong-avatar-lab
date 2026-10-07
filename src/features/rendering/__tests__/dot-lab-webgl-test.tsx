// @vitest-environment jsdom
/**
 * The WebGL2 column of the material lab.
 *
 * jsdom has no WebGL2, which is itself one of the cases under test: without
 * a context the cell must report its absence rather than a number, and the
 * metrics panel must measure a canvas slot through pixel readback with the
 * *same* arithmetic the SVG slots use — asserted here by feeding synthetic
 * pixels through the real panel and comparing the printed report against
 * `measurePixels` itself. If the two paths ever diverge, the column's
 * numbers stop meaning what the thresholds say they mean.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultBlobConfig } from '@/features/rendering/blob/blobTypes'
import { DotLabMetrics } from '@/features/rendering/components/DotLabMetrics'
import { measurePixels, referenceTargets } from '@/features/rendering/dotLabMetrics'
import { readRasterCanvas } from '@/features/rendering/dotLabRaster'
import { disposeLabWebgl, renderLabWebglCell } from '@/features/rendering/dotLabWebgl'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

afterEach(() => {
  // Restore whatever jsdom provided before the fake2d substitution.
  if (originalGetContext) {
    HTMLCanvasElement.prototype.getContext = originalGetContext
    originalGetContext = undefined
  }
})

let originalGetContext: HTMLCanvasElement['getContext'] | undefined

describe('lab WebGL2 cell without WebGL2', () => {
  it('reports unavailability instead of drawing anything', () => {
    // jsdom exposes no webgl2: the shared context stays uncreated, the cell
    // returns false, and the target canvas is untouched — never a blank
    // rectangle that would later measure as a zero-scoring cell.
    const target = document.createElement('canvas')
    expect(target.width).toBe(300)
    expect(renderLabWebglCell(createDefaultBlobConfig(), target)).toBe(false)
    // The resize only happens after a successful draw.
    expect(target.width).toBe(300)
  })

  it('measures an unreadable canvas as null so the panel skips it', () => {
    // No 2D context in jsdom: readRasterCanvas must skip, not throw — one
    // dead cell may never blank the whole report.
    expect(readRasterCanvas(document.createElement('canvas'))).toBeNull()
    const zero = document.createElement('canvas')
    zero.width = 0
    zero.height = 0
    expect(readRasterCanvas(zero)).toBeNull()
  })

  it('can dispose a context that was never created', () => {
    expect(() => disposeLabWebgl()).not.toThrow()
  })
})

describe('DotLabMetrics webgl2 slot', () => {
  it('measures a canvas cell with the same arithmetic as the SVG slots', async () => {
    // Synthetic 16x16 chromatic gradient with known answers: a per-column
    // ramp in green gives texture, the full r..b span gives range, and the
    // red-to-blue distance gives saturation.
    const size = 16
    const data = new Uint8ClampedArray(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4
        data[offset] = 8 + x
        data[offset + 1] = 60 + x * 10
        data[offset + 2] = 200 - x * 2
        data[offset + 3] = 255
      }
    }
    const expected = measurePixels(data, size, size)
    expect(expected.samples).toBe(size * size)
    expect(expected.saturation).toBeGreaterThan(referenceTargets.saturation)
    expect(expected.range).toBeGreaterThan(referenceTargets.range)
    expect(expected.texture).toBeGreaterThan(referenceTargets.texture)

    originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      if (type === '2d') {
        return {
          getImageData: (_x: number, _y: number, width: number, height: number) => ({
            data,
            width,
            height,
          }),
        } as unknown as CanvasRenderingContext2D
      }
      return originalGetContext?.call(this, type as never)
    } as HTMLCanvasElement['getContext']

    const grid = document.createElement('div')
    grid.innerHTML =
      '<span data-slot="webgl2" data-chroma="1"><canvas width="16" height="16"></canvas></span>'
    document.body.appendChild(grid)

    render(<DotLabMetrics containerRef={{ current: grid }} revision="test" />)
    fireEvent.click(screen.getByRole('button', { name: /Misura/ }))

    await waitFor(() => {
      // The printed report must be `measurePixels` on these very pixels —
      // same values, same rounding, against the same thresholds.
      expect(screen.getByText(`${expected.saturation.toFixed(3)}/0.650`)).toBeTruthy()
      expect(screen.getByText(`${expected.range.toFixed(1)}/100.0`)).toBeTruthy()
      expect(screen.getByText(`${expected.texture.toFixed(2)}/3.50`)).toBeTruthy()
    })

    const report = document.querySelector('.dot-lab-slot-report')
    expect(report?.querySelector('strong')?.textContent?.startsWith('webgl2')).toBe(true)
    expect(report?.querySelector('strong em')?.textContent).toBe('1')
    // All three synthetic metrics clear their targets, so every row marks pass.
    expect(report?.querySelectorAll('.dot-lab-metric.is-pass').length).toBe(3)
    expect(document.querySelector('.dot-lab-metrics-error')).toBeNull()
  })
})

describe('lab column wiring', () => {
  it('renders the WebGL2 column through the shared context and frees it on unmount', () => {
    const lab = read('../components/DotMaterialLab.tsx')
    expect(lab).toContain('renderLabWebglCell')
    expect(lab).toContain(`mode === 'webgl2'`)
    expect(lab).toContain('disposeLabWebgl')
    expect(lab).toContain('useState(() => hasWebgl2())')
    // The cell is a still frame: no loop, no per-frame React state.
    expect(lab).not.toContain('requestAnimationFrame')

    const webgl = read('../dotLabWebgl.ts')
    expect(webgl).toContain('LAB_RASTER_SIZE')
    expect(webgl).not.toContain('Math.random')
    expect(webgl).not.toContain("from 'three'")
    expect(webgl).not.toContain('useMemo')
    expect(webgl).not.toContain('useCallback')
  })

  it('measures the canvas slot before the svg slot and orders the report webgl2-last', () => {
    const metrics = read('../components/DotLabMetrics.tsx')
    // Canvas first: a WebGL cell must never be measured through the SVG path.
    const canvasIndex = metrics.indexOf("holder.querySelector('canvas')")
    const svgIndex = metrics.indexOf("holder.querySelector('svg')")
    expect(canvasIndex).toBeGreaterThan(-1)
    expect(svgIndex).toBeGreaterThan(-1)
    expect(canvasIndex).toBeLessThan(svgIndex)
    expect(metrics).toContain(`webgl2: 'webgl2'`)
    expect(metrics).toContain(`['flat', 'field', 'perPixel', 'webgl2']`)

    // The raster size is shared by both paths: texture is a per-neighbour
    // difference, so differently sized slots are not comparable numbers.
    const raster = read('../dotLabRaster.ts')
    expect(raster).toContain('export const LAB_RASTER_SIZE = 160')
    expect(read('../dotLabWebgl.ts')).toContain('LAB_RASTER_SIZE')
  })

  it('keeps the flat control chromatic-scored and the readback on the calibrated backend', () => {
    // The flat span is the saturation control: without the chroma marker the
    // oracle reports sat 0.000 for it — a plausible-looking number that
    // silently drops every flat cell from the chromatic average.
    const lab = read('../components/DotMaterialLab.tsx')
    const flatSpan = lab.match(/data-slot="flat"[\s\S]{0,240}?data-chroma=/)
    expect(flatSpan).not.toBeNull()

    // `willReadFrequently` moves the canvas onto the CPU backend, whose
    // rounding on antialiased pixels shifts `texture` on identical input
    // (measured: field 3.54 -> 3.44, per-pixel 5.31 -> 6.04) — enough to
    // flip the field renderer's verdict against the committed fixture.
    const raster = read('../dotLabRaster.ts')
    expect(raster).not.toContain(`getContext('2d', {`)
    expect(raster).toContain(`canvas.getContext('2d')`)
  })
})
