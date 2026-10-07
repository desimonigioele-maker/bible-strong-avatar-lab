// Acceptance checks for the DOT MATERIAL LAB oracle, headless.
//
// Serves the production build with an embedded static server, drives the lab
// with Playwright, presses Compare + "Misura le celle" and asserts what the
// committed docs promise: four measured slots at 128 cells each, the flat
// control passing range while failing texture (otherwise the metric is not
// measuring material), and every renderer verdict — field, per-pixel and the
// webgl2 column — green against the reference targets.
//
// Self-contained like ../dot-surface/verify-dot-surface.mjs: no test runner,
// no repo dependency on Playwright. Requires a current `pnpm build` (dist/)
// and either `PLAYWRIGHT_PATH` or a playwright install at
// /tmp/dot-verify/node_modules/playwright.
//
// GPU warning: the texture metric is rasterizer-dependent. Chromium's
// software rasterizer renders the SVG slots a touch softer and field lands
// at ~3.44, below the 3.5 floor — the same CPU-backend artifact documented
// in docs/blob-rendering.md for `willReadFrequently`. The run therefore
// forces full Chromium with Metal GPU rasterization (`channel: 'chromium'`);
// on a machine without a GPU this script reports the software numbers and
// L10 will fail with them, which is a true statement about that machine.
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const playwright = require(process.env.PLAYWRIGHT_PATH ?? '/tmp/dot-verify/node_modules/playwright')
const chromium = playwright.chromium

const outDir = fileURLToPath(new URL('.', import.meta.url))
const distDir = fileURLToPath(new URL('../../../dist', import.meta.url))
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}
const servers = []
const startStaticServer = rootDir =>
  new Promise(resolve => {
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost')
        const pathname = decodeURIComponent(url.pathname)
        let filePath = normalize(join(rootDir, pathname))
        if (!filePath.startsWith(normalize(rootDir))) throw new Error('forbidden')
        const info = await stat(filePath).catch(() => null)
        if (!info || info.isDirectory()) filePath = join(rootDir, 'index.html')
        const content = await readFile(filePath)
        response.writeHead(200, {
          'content-type': mime[extname(filePath)] ?? 'application/octet-stream',
        })
        response.end(content)
      } catch {
        response.writeHead(404)
        response.end()
      }
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`))
  })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('dist/ not found — run `pnpm build` first')
  process.exit(1)
}

const baseURL = await startStaticServer(distDir)
const browser = await chromium.launch({
  // Full Chromium (not the headless shell) so rasterization can use the GPU:
  // Metal on macOS. SwiftShader stays enabled as the WebGL fallback — the
  // fourth column must exist even where the GPU is absent.
  channel: 'chromium',
  args: ['--enable-unsafe-swiftshader', '--enable-gpu', '--use-angle=metal'],
})
const context = await browser.newContext({ viewport: { width: 1480, height: 940 } })
const page = await context.newPage()
const consoleIssues = []
page.on('console', message => {
  // Chromium GPU-driver performance notes are environment noise, not app issues.
  if (message.text().includes('GL Driver Message')) return
  // Chrome suggesting `willReadFrequently` for the oracle's repeated
  // readbacks: the lab deliberately declines it (see dotLabRaster.ts), so
  // the suggestion firing IS the correct behavior, not a regression.
  if (message.text().includes('willReadFrequently')) return
  if (['error', 'warning'].includes(message.type())) consoleIssues.push(message.text())
})
page.on('pageerror', error => consoleIssues.push(`pageerror: ${error.message}`))

// Vercel Analytics/Speed Insights inject scripts that do not exist outside
// Vercel hosting; stub them so the page boots cleanly offline.
await page.route('**/_vercel/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
)

await page.goto(`${baseURL}#dot-lab`, { waitUntil: 'networkidle' })

// L1 — the grid renders.
await page.waitForSelector('[data-slot="flat"] svg', { timeout: 30000 })
const holderCounts = await page.evaluate(() =>
  [...document.querySelectorAll('[data-slot]')].reduce((counts, holder) => {
    counts[holder.dataset.slot] = (counts[holder.dataset.slot] ?? 0) + 1
    return counts
  }, {})
)
check('L1 lab grid renders 128 flat cells', holderCounts.flat === 128, JSON.stringify(holderCounts))

// L2 — the capability hint must report the real state (this machine: on).
const hint = (await page.locator('.dot-lab-hint').textContent()) ?? ''
check('L2 hint reports webgl2 on', hint.includes('webgl2 on'), hint.trim().slice(0, 140))

// L3 — Compare mode shows all four columns, canvas cells included.
await page.locator('button:has-text("Compare")').first().click()
await page.waitForSelector('[data-slot="webgl2"] canvas', { timeout: 30000 })
const compareCounts = await page.evaluate(() => {
  const counts = {}
  for (const holder of document.querySelectorAll('[data-slot]')) {
    counts[holder.dataset.slot] = (counts[holder.dataset.slot] ?? 0) + 1
  }
  return {
    counts,
    naCells: document.querySelectorAll('.dot-lab-webgl-na').length,
  }
})
check(
  'L3 compare renders 4 slots x 128 cells',
  compareCounts.counts.flat === 128 &&
    compareCounts.counts.field === 128 &&
    compareCounts.counts.perPixel === 128 &&
    compareCounts.counts.webgl2 === 128 &&
    compareCounts.naCells === 0,
  JSON.stringify(compareCounts)
)

// L4 — the webgl2 cells are pixels, not empty canvases: the oracle must
// measure what the shared context actually painted.
const painted = await page.evaluate(() => {
  const canvas = document.querySelector('[data-slot="webgl2"] canvas')
  if (!canvas) return 0
  const context2d = canvas.getContext('2d')
  if (!context2d) return -1
  const pixels = context2d.getImageData(0, 0, canvas.width, canvas.height).data
  let count = 0
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) count++
  return count
})
// The silhouette at 160² is ~9 100 pixels plus antialiasing (~9 800
// measured); anything above half of that is a painted dot, anything near
// zero is an empty canvas.
check('L4 webgl2 cells are painted', painted > 5000, `${painted} non-transparent pixels`)

// L5 — run the oracle. The report only appears when the run finishes, so a
// four-slot report IS the completion signal; polling is interval-based
// because rAF may be starved in a headless/idle window.
await page.locator('button:has-text("Misura le celle")').first().click()
await page.waitForFunction(
  () => document.querySelectorAll('.dot-lab-slot-report').length >= 4,
  undefined,
  { timeout: 120000, polling: 250 }
)

const report = await page.evaluate(() => ({
  error: document.querySelector('.dot-lab-metrics-error')?.textContent ?? null,
  slots: [...document.querySelectorAll('.dot-lab-slot-report')].map(slot => ({
    title: (slot.querySelector('strong')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    cells: slot.querySelector('strong em')?.textContent ?? '',
    rows: [...slot.querySelectorAll('.dot-lab-metric')].map(row => ({
      label: row.querySelector('.dot-lab-metric-label')?.textContent ?? '',
      value: row.querySelector('.dot-lab-metric-value')?.textContent ?? '',
      pass: row.classList.contains('is-pass'),
    })),
  })),
}))
const byTitle = Object.fromEntries(
  report.slots.map(slot => [slot.title.replace(/ \d+$/, ''), slot])
)
const rowsOf = title =>
  Object.fromEntries((byTitle[title]?.rows ?? []).map(row => [row.label, row]))
const detail = title => {
  const slot = byTitle[title]
  if (!slot) return 'slot missing'
  return `${slot.cells} cells · ${slot.rows.map(row => `${row.label} ${row.value}${row.pass ? '✓' : '✕'}`).join(' · ')}`
}

check('L6 oracle reports no error', report.error === null, report.error ?? '')
check(
  'L7 four slots measured, in order',
  report.slots.length === 4 &&
    report.slots[0].title.startsWith('flat control') &&
    report.slots[1].title.startsWith('field') &&
    report.slots[2].title.startsWith('per-pixel') &&
    report.slots[3].title.startsWith('webgl2'),
  report.slots.map(slot => slot.title).join(' | ')
)
check(
  'L8 every slot measured 128 cells',
  report.slots.every(slot => slot.cells === '128'),
  report.slots.map(slot => `${slot.title}=${slot.cells}`).join(' ')
)

// L9 — the control contract: the flat reference must pass range and FAIL
// texture, otherwise the oracle is not measuring material.
const flat = rowsOf('flat control')
check(
  'L9 flat control passes rng, fails tex (and keeps a real saturation)',
  Boolean(flat.sat?.pass && flat.rng?.pass && flat.tex && !flat.tex.pass),
  detail('flat control')
)

// L10 — every renderer verdict green: field, per-pixel and the webgl2
// column, three metrics each, against the reference targets.
for (const title of ['field', 'per-pixel', 'webgl2']) {
  const rows = rowsOf(title)
  const green =
    report.slots.length === 4 && ['sat', 'rng', 'tex'].every(label => rows[label]?.pass === true)
  check(`L10 ${title} verdicts all green`, green, detail(title))
}

await page
  .locator('.dot-lab-header')
  .screenshot({ path: join(outDir, 'dot-lab-oracle-1-report.png') })
await page
  .locator('.dot-lab-row')
  .first()
  .screenshot({ path: join(outDir, 'dot-lab-oracle-2-row.png') })

// L11 — console hygiene.
check(
  'L11 no console errors/warnings',
  consoleIssues.length === 0,
  consoleIssues.slice(0, 3).join(' | ')
)

await browser.close()
servers.forEach(server => server.close())
const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
