// Quantifies the before/after difference of the softer dot preset by reading
// pixel statistics of the acceptance screenshots via an offscreen canvas.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const playwright = require(process.env.PLAYWRIGHT_PATH ?? '/tmp/dot-verify/node_modules/playwright')
const outDir = fileURLToPath(new URL('.', import.meta.url))

const stages = [
  ['classic', '-before'],
  ['softer', '-softer'],
  ['plush', ''],
]
const scenes = [
  ['blob default', 'dots-acceptance-1-blob'],
  ['purple #7c5cff', 'dots-acceptance-3-purple'],
]
const pairs = scenes.map(([sceneLabel, prefix]) => ({
  label: sceneLabel,
  stages: stages.map(([stageLabel, suffix]) => ({
    label: stageLabel,
    dataUrl: `data:image/png;base64,${readFileSync(join(outDir, `${prefix}${suffix}.png`)).toString('base64')}`,
  })),
}))

const browser = await playwright.chromium.launch()
const page = await browser.newPage()

const statsFor = await page.evaluate(async pairs => {
  const stats = async dataUrl => {
    const image = new Image()
    image.src = dataUrl
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
    })
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let r = 0
    let g = 0
    let b = 0
    let lum = 0
    let highlightPixels = 0
    const total = data.length / 4
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] / 255
      const green = data[index + 1] / 255
      const blue = data[index + 2] / 255
      r += red
      g += green
      b += blue
      const l = 0.2126 * red + 0.7152 * green + 0.0722 * blue
      lum += l
      if (l > 0.85) highlightPixels += 1
    }
    return {
      r: (r / total).toFixed(4),
      g: (g / total).toFixed(4),
      b: (b / total).toFixed(4),
      lum: (lum / total).toFixed(4),
      highlightPct: ((highlightPixels / total) * 100).toFixed(2),
    }
  }
  const output = []
  for (const { label, stages } of pairs) {
    output.push({
      label,
      stages: await Promise.all(
        stages.map(async stage => ({ label: stage.label, stats: await stats(stage.dataUrl) }))
      ),
    })
  }
  return output
}, pairs)

for (const { label, stages } of statsFor) {
  console.log(`--- ${label} ---`)
  const first = stages[0].stats
  for (const { label: stageLabel, stats } of stages) {
    const deltaLum = (((stats.lum - first.lum) / first.lum) * 100).toFixed(1)
    console.log(
      `  ${stageLabel.padEnd(8)} lum ${stats.lum} (${deltaLum}% vs classic)  rgb ${stats.r}/${stats.g}/${stats.b}  hi% ${stats.highlightPct}`
    )
  }
}

await browser.close()
