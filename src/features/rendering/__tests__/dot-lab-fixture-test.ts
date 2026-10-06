// Maintenance hook for the DOT MATERIAL LAB (FASI 41, 42).
//
// No-op in the regular suite: set DOT_LAB_DIR to generate a static gallery of
// the whole 4 x 8 x 2 matrix, plus a before/after comparison document. The
// React page in `features/rendering/components/DotMaterialLab.tsx` is the
// working surface; this is the committed evidence, and it must render the same
// dots, so both read the matrix from `features/rendering/dotLabGrid.ts`.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { measureScriptSource, referenceTargets } from '@/features/rendering/dotLabMetrics'
import { createBlobMaterial } from '@/features/rendering/blob/blobMaterial'
import { buildSurfaceField } from '@/features/rendering/blob/blobSurfaceField'
import { renderBlobToSvg } from '@/features/rendering/blob/blobSvg'
import {
  labCellConfig,
  labLights,
  labMaterialChromatic,
  labMaterials,
  labQuality,
  labRestPose,
  labShapes,
  labSurfaceConfig,
  labTextureFor,
} from '@/features/rendering/dotLabGrid'

/** The control: one radial gradient over the base colour. */
const flatReference = (config: ReturnType<typeof labCellConfig>, idPrefix: string): string => {
  const material = createBlobMaterial(config.material)
  return (
    `<svg viewBox="-160 -160 320 320"><defs>` +
    `<radialGradient id="${idPrefix}" cx="35%" cy="30%" r="78%">` +
    `<stop offset="0" stop-color="${material.palette.highlight}"/>` +
    `<stop offset="0.55" stop-color="${material.palette.base}"/>` +
    `<stop offset="1" stop-color="${material.palette.shadow}"/>` +
    `</radialGradient></defs>` +
    `<circle cx="0" cy="0" r="${config.shape.radius}" fill="url(#${idPrefix})"/>` +
    `</svg>`
  )
}

const PAGE_HEAD = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>DOT MATERIAL LAB</title>
<style>
  body { margin:0; padding:20px 24px 60px; background:#14161a; color:#e7ebf0;
         font-family: ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size:15px; letter-spacing:.14em; }
  h2 { font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#7b8794;
       margin:22px 0 8px; }
  .cells { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:10px; }
  .cell { background:#191d23; border:1px solid #232a33; border-radius:10px; overflow:hidden; margin:0; }
  .row  { display:grid; grid-template-columns:repeat(3,1fr); }
  .row  > * { min-width:0; }
  .row  > span { display:block; }
  svg  { display:block; width:100%; height:auto; }
  figcaption { display:flex; flex-direction:column; font-size:10px; line-height:1.35;
               color:#6f7a86; padding:6px 8px 7px; border-top:1px solid #232a33; }
  figcaption strong { color:#d7dee7; font-size:11px; }
  p.hint { font-size:11px; color:#6f7a86; }
  .report { background:#191d23; border:1px solid #232a33; border-radius:8px;
            padding:8px 10px 9px; margin:16px 0 6px; }
  .report-title { font-size:11px; letter-spacing:.1em; text-transform:uppercase;
                  color:#7b8794; font-weight:600; margin-right:10px; }
  .report-hint { font-size:11px; color:#6f7a86; }
  .report-body { display:flex; flex-wrap:wrap; gap:14px; margin-top:9px;
                 padding-top:9px; border-top:1px solid #232a33; }
  .slot { display:flex; flex-direction:column; gap:2px; min-width:172px; }
  .slot strong { font-size:11px; color:#d7dee7; display:flex; justify-content:space-between; gap:8px; }
  .slot strong em { font-style:normal; color:#6f7a86; font-weight:400; }
  .m { display:grid; grid-template-columns:30px 1fr 12px; gap:8px; font-size:10.5px;
       font-variant-numeric:tabular-nums; color:#8b96a3; }
  .ml { color:#6f7a86; }
  .m.ok .mm { color:#5fc98d; }
  .m.bad .mm, .m.bad .mv { color:#e08585; }
</style></head><body>`

/**
 * The report the static gallery prints for itself.
 *
 * The committed evidence file cannot import the metrics module, so the
 * arithmetic arrives as source (`measureScriptSource`) and is compared against
 * the real function by `dot-lab-metrics-test.ts`. What is assembled here is
 * only the page side: find the cells, rasterize them, average by slot, print.
 */
const REPORT_MARKUP =
  `<div class="report" id="report">` +
  `<span class="report-title">Misura</span>` +
  `<span class="report-hint">soglie dal riferimento: sat ≥ ${referenceTargets.saturation} (soli materiali cromatici)` +
  ` · rng ≥ ${referenceTargets.range} · tex ≥ ${referenceTargets.texture}</span>` +
  `<div class="report-body" id="report-body">in corso…</div></div>`

const REPORT_DRIVER = `
(async () => {
  const SIZE = 160
  const holders = [...document.querySelectorAll('[data-slot]')]
  const buckets = { flat: [], field: [], perPixel: [] }
  // Saturation is aggregated over chromatic materials only: the reference
  // artwork is four chromatic characters, so neutral materials (milk, matte,
  // pale glass) are compared on range and texture, per the metric's own rule.
  const chromaSats = { flat: [], field: [], perPixel: [] }
  const rasterize = (svg) => new Promise((resolve) => {
    const clone = svg.cloneNode(true)
    clone.setAttribute('width', String(SIZE))
    clone.setAttribute('height', String(SIZE))
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SIZE; canvas.height = SIZE
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, SIZE, SIZE)
        ctx.drawImage(image, 0, 0, SIZE, SIZE)
        resolve(measurePixels(ctx.getImageData(0, 0, SIZE, SIZE).data, SIZE, SIZE))
      } catch (error) { resolve(null) }
    }
    image.onerror = () => resolve(null)
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
  })
  for (const holder of holders) {
    const svg = holder.querySelector('svg')
    if (!svg) continue
    const metric = await rasterize(svg)
    if (metric && metric.samples > 0) {
      buckets[holder.dataset.slot].push(metric)
      if (holder.dataset.chroma === '1') chromaSats[holder.dataset.slot].push(metric.saturation)
    }
  }
  const mean = (list, key) => list.length === 0 ? 0 : list.reduce((t, m) => t + m[key], 0) / list.length
  const LABEL = { flat: 'flat control', field: 'field', perPixel: 'per-pixel' }
  const order = ['flat', 'field', 'perPixel']
  const target = ${JSON.stringify(referenceTargets)}
  const mark = (value, threshold) => value >= threshold ? '✓' : '✕'
  const row = (label, value, threshold, digits) =>
    '<span class="m ' + (value >= threshold ? 'ok' : 'bad') + '">' +
    '<span class="ml">' + label + '</span>' +
    '<span class="mv">' + value.toFixed(digits) + '/' + threshold.toFixed(digits) + '</span>' +
    '<span class="mm">' + mark(value, threshold) + '</span></span>'
  const html = order.filter(key => buckets[key].length > 0).map(key => {
    const list = buckets[key]
    const sats = chromaSats[key]
    const sat = sats.length === 0 ? 0 : sats.reduce((total, value) => total + value, 0) / sats.length
    const rng = mean(list, 'range')
    const tex = mean(list, 'texture')
    return '<div class="slot"><strong>' + LABEL[key] + ' <em>' + list.length + '</em></strong>' +
      row('sat', sat, target.saturation, 3) +
      row('rng', rng, target.range, 1) +
      row('tex', tex, target.texture, 2) + '</div>'
  }).join('')
  document.getElementById('report-body').innerHTML =
    html || 'nessuna cella misurabile'
})()
`

describe('DOT MATERIAL LAB fixture', () => {
  it('generates the static gallery when DOT_LAB_DIR is set', () => {
    const fixtureDir = process.env.DOT_LAB_DIR
    if (!fixtureDir) return

    const pose = labRestPose()
    // The field depends only on the silhouette, so it is built once per shape
    // rather than once per cell.
    const fields = new Map(
      labShapes.map(shape => {
        const config = labCellConfig(shape, labMaterials[0], labLights[0])
        return [shape.family, buildSurfaceField(pose, labSurfaceConfig(config))] as const
      })
    )

    const rows: string[] = []
    for (const shape of labShapes) {
      const cells: string[] = []
      for (const material of labMaterials) {
        for (const light of labLights) {
          const id = `g-${shape.family}-${material}-${light.id}`
          const field = labCellConfig(shape, material, light, 'field')
          const pixel = labCellConfig(shape, material, light, 'perPixel')
          const chroma = labMaterialChromatic(field.material) ? '1' : '0'
          cells.push(
            `<figure class="cell"><div class="row">` +
              `<span data-slot="flat" data-chroma="${chroma}">` +
              flatReference(field, `${id}-flat`) +
              '</span>' +
              `<span data-slot="field" data-chroma="${chroma}">` +
              renderBlobToSvg(field, {
                idPrefix: `${id}-f`,
                field: fields.get(shape.family),
                pose,
                texture: labTextureFor(field.material),
                withExpression: false,
                groundShadow: false,
                width: '100%',
                height: '100%',
              }) +
              '</span>' +
              `<span data-slot="perPixel" data-chroma="${chroma}">` +
              renderBlobToSvg(pixel, {
                idPrefix: `${id}-p`,
                field: fields.get(shape.family),
                pose,
                texture: labTextureFor(pixel.material),
                withExpression: false,
                groundShadow: false,
                width: '100%',
                height: '100%',
              }) +
              '</span>' +
              `</div><figcaption><strong>${material}</strong><span>${shape.family}</span>` +
              `<span>${light.id}</span><span>seed ${field.shape.seed}</span></figcaption></figure>`
          )
        }
      }
      rows.push(`<h2>${shape.family}</h2><div class="cells">${cells.join('')}</div>`)
    }

    mkdirSync(fixtureDir, { recursive: true })
    const galleryPath = join(fixtureDir, 'dot-material-lab.html')
    writeFileSync(
      galleryPath,
      `${PAGE_HEAD}<h1>DOT MATERIAL LAB</h1>` +
        `<p class="hint">${labShapes.length} shapes x ${labMaterials.length} materials x ` +
        `${labLights.length} lighting · quality ${labQuality} · ` +
        `each cell: flat reference / field / per-pixel</p>` +
        REPORT_MARKUP +
        rows.join('') +
        `<script>${measureScriptSource}\n${REPORT_DRIVER}</script></body></html>`
    )
    expect(existsSync(galleryPath)).toBe(true)
    console.log(`[dot-lab] static gallery written to ${galleryPath}`)
  })
})
