// Acceptance checks for the "dot" 3D surface (A1–A7 of the brief).
// Self-contained: serves the production build with an embedded static server,
// drives the studio with Playwright, verifies, screenshots.
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const playwright = require(process.env.PLAYWRIGHT_PATH ?? '/tmp/dot-verify/node_modules/playwright')
const chromium = playwright.chromium

// The script lives in <repo>/docs/acceptance/dot-surface and always writes its
// screenshots next to itself, regardless of the caller's working directory.
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
const baseURL = await startStaticServer(distDir)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1480, height: 940 },
  acceptDownloads: true,
})
const page = await context.newPage()
const consoleIssues = []
const allConsole = []
page.on('console', message => {
  // Chromium GPU-driver performance notes are environment noise, not app issues.
  if (message.text().includes('GL Driver Message')) return
  allConsole.push(`[${message.type()}] ${message.text()}`)
  if (['error', 'warning'].includes(message.type())) consoleIssues.push(message.text())
})
page.on('pageerror', error =>
  allConsole.push(`[pageerror] ${error.message}\n${error.stack ?? ''}`.slice(0, 400))
)
page.on('pageerror', error => consoleIssues.push(`pageerror: ${error.message}`))
page.on('requestfailed', request =>
  allConsole.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`)
)
page.on('response', response => {
  const contentType = response.headers()['content-type'] ?? ''
  if (
    response.status() >= 400 ||
    (contentType.includes('text/html') && response.url().includes('/assets/'))
  )
    allConsole.push(`[http ${response.status()} ${contentType}] ${response.url()}`)
})
page.on('domcontentloaded', () => allConsole.push('[event] domcontentloaded'))
page.on('load', () => allConsole.push('[event] load'))

// Vercel Analytics/Speed Insights inject scripts from /_vercel/* which do not
// exist outside Vercel hosting; stub them so the page boots cleanly offline.
await page.route('**/_vercel/**', route =>
  route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
)

await page.goto(baseURL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
console.log('--- console dump ---')
allConsole.slice(0, 40).forEach(line => console.log(line))
console.log('--- end dump ---')

// The studio boots on the Avatars page. Enter body editing by double-clicking
// the first avatar card ("Double-click to edit").
const firstAvatarCard = page.locator('button:has-text("Strobi")').first()
await firstAvatarCard.dblclick()
await page.waitForTimeout(900)

// A6 — SVG surfaces still render (baseline before switching).
const svgPathLocator = page.locator('.avatar-wrap svg path').first()
const svgPathBefore = await svgPathLocator.getAttribute('d', { timeout: 8000 }).catch(() => null)
check('A6 SVG baseline renders', Boolean(svgPathBefore && svgPathBefore.length > 20))

// A1 — pick the dot surface (EN UI label: "3D Dot", FR: "Dot 3D").
const dotCard = page.locator('button:has-text("3D Dot"), button:has-text("Dot 3D")').first()
const dotCardVisible = await dotCard.isVisible({ timeout: 8000 }).catch(() => false)
if (dotCardVisible) {
  await dotCard.click()
  await page.waitForSelector('.dot-webgl-canvas canvas', { timeout: 15000 })
  const canvas = page.locator('.dot-webgl-canvas canvas')
  check('A1 dot surface shows WebGL canvas', await canvas.isVisible())
  await page.waitForTimeout(1800)
  await page
    .locator('.avatar-wrap')
    .screenshot({ path: join(outDir, 'dots-acceptance-1-blob.png') })

  // A2 — the R3F canvas has a live WebGL context (blob + eyes drawing).
  const glInfo = await canvas.evaluate(canvasElement => {
    const gl = canvasElement.getContext('webgl2') ?? canvasElement.getContext('webgl')
    if (!gl) return null
    return {
      width: canvasElement.width,
      height: canvasElement.height,
      drawingBufferWidth: gl.drawingBufferWidth,
    }
  })
  check('A2 WebGL context live', Boolean(glInfo && glInfo.width > 0))

  // A3 — change the dot color from the panel; state + canvas update live.
  const colorInput = page.locator('.surface-fields input[type="color"]').first()
  const colorVisible = await colorInput.isVisible({ timeout: 5000 }).catch(() => false)
  if (colorVisible) {
    await colorInput.fill('#7c5cff')
    await page.waitForTimeout(400)

    // A8 — softness select: switch to Classic; trigger label reflects the pick.
    const softnessTrigger = page
      .locator(
        '[data-slot="select-trigger"][aria-label="Softness"], [data-slot="select-trigger"][aria-label="Morbidesse"]'
      )
      .first()
    const softnessVisible = await softnessTrigger.isVisible({ timeout: 5000 }).catch(() => false)
    if (softnessVisible) {
      await softnessTrigger.click()
      await page.waitForTimeout(300)
      await page
        .locator(
          '[data-slot="select-item"]:has-text("Classic"), [data-slot="select-item"]:has-text("Classique")'
        )
        .first()
        .click()
      await page.waitForTimeout(300)
      const triggerLabel = (await softnessTrigger.textContent()) ?? ''
      check(
        'A8 softness selector switches to Classic',
        triggerLabel.includes('Classic'),
        triggerLabel.trim()
      )
    } else {
      check('A8 softness selector visible', false, 'select trigger not found in dot fields')
    }

    // Body-editing sessions defer persistence until Save.
    await page.locator('button:has-text("Save"), button:has-text("Enregistrer")').first().click()
    await page.waitForTimeout(800)
    const persisted = await page.evaluate(() =>
      localStorage.getItem('bible-strong-avatar-studio-v2')
    )
    check('A3 color change reaches document state', Boolean(persisted?.includes('#7c5cff')))
    check('A8b softness persists to document', Boolean(persisted?.includes('"softness":"classic"')))
    await page
      .locator('.avatar-wrap')
      .screenshot({ path: join(outDir, 'dots-acceptance-3-purple.png') })
  } else {
    check('A3 color field visible', false, 'input[type=color] not found in .surface-fields')
  }

  // A4 — reload restores the dot surface with parameters.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const restored = await page.evaluate(() => localStorage.getItem('bible-strong-avatar-studio-v2'))
  check(
    'A4 persistence round-trip',
    Boolean(
      restored?.includes('"dot"') &&
      restored?.includes('#7c5cff') &&
      restored?.includes('"softness":"classic"')
    )
  )

  // Snapshot — Photo Mode capture with the dot surface rasterizes WebGL to PNG.
  await page.locator('button:has-text("Photo Mode")').first().click()
  await page.waitForTimeout(800)
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 })
  await page.locator('.photo-capture-button').click()
  const download = await downloadPromise.catch(() => null)
  check(
    'Snapshot downloads a PNG of the dot scene',
    Boolean(download && download.suggestedFilename().endsWith('.png')),
    download?.suggestedFilename()
  )
} else {
  check('A1 dot surface card visible', false, 'surface picker not reachable from automation')
}

// A7 — console hygiene.
check(
  'A7 no console errors/warnings',
  consoleIssues.length === 0,
  consoleIssues.slice(0, 3).join(' | ')
)

// A5 — the generated standalone export mounts the dot WebGL scene offline.
const exportDir = process.env.EXPORT_DIR ?? '/tmp/dot-verify/export'
if (existsSync(join(exportDir, 'avatar.js'))) {
  const exportBaseURL = await startStaticServer(exportDir)
  const exportPage = await context.newPage()
  const exportIssues = []
  exportPage.on('console', message => {
    if (message.text().includes('GL Driver Message')) return
    if (['error', 'warning'].includes(message.type())) exportIssues.push(message.text())
  })
  exportPage.on('pageerror', error => exportIssues.push(`pageerror: ${error.message}`))
  await exportPage.goto(exportBaseURL, { waitUntil: 'networkidle' })
  await exportPage.waitForSelector('#avatar canvas', { timeout: 20000 })
  await exportPage.waitForTimeout(1500)
  const runtimeInfo = await exportPage.evaluate(() => {
    for (const canvasElement of [...document.querySelectorAll('#avatar canvas')]) {
      if (canvasElement.width < 100) continue
      const gl = canvasElement.getContext('webgl2') ?? canvasElement.getContext('webgl')
      if (!gl) continue
      const pixel = new Uint8Array(4)
      gl.readPixels(
        gl.drawingBufferWidth >> 1,
        gl.drawingBufferHeight >> 1,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel
      )
      return {
        width: canvasElement.width,
        rgb: [pixel[0], pixel[1], pixel[2]],
        hasAvatarApi:
          typeof window.avatar?.play === 'function' && typeof window.avatar?.destroy === 'function',
      }
    }
    return null
  })
  check(
    'A5a export runtime mounts dot WebGL scene',
    Boolean(runtimeInfo && runtimeInfo.rgb.some(value => value > 12)),
    runtimeInfo
      ? `canvas ${runtimeInfo.width}px rgb=${runtimeInfo.rgb.join(',')}`
      : 'no live canvas'
  )
  check('A5b export exposes avatar API', Boolean(runtimeInfo?.hasAvatarApi))
  await exportPage
    .locator('#avatar')
    .screenshot({ path: join(outDir, 'dots-acceptance-5-export.png') })
  check('A5c export console clean', exportIssues.length === 0, exportIssues.slice(0, 3).join(' | '))
  await exportPage.close()
} else {
  check(
    'A5 export fixture present',
    false,
    `generate with EXPORT_FIXTURE_DIR=${exportDir} corepack pnpm exec vitest run export-fixture-test`
  )
}

await browser.close()
servers.forEach(server => server.close())
const failed = results.filter(result => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
