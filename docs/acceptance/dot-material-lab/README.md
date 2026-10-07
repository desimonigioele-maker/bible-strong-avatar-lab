# DOT material lab — acceptance evidence

The static gallery for the DOT MATERIAL LAB. It is the measurement instrument for
`src/features/rendering/`: the renderer was tuned against it, not by eye.

## Regenerating

```bash
DOT_LAB_DIR=docs/acceptance/dot-material-lab npx vitest run \
  src/features/rendering/__tests__/dot-lab-fixture-test.ts
```

Without `DOT_LAB_DIR` the test skips the write and only asserts the matrix is well formed.

The output is one self-contained HTML file, roughly 5 MB: 64 cells (4 shape families × 8 materials ×
2 lighting setups), each holding up to three renders — the flat reference, the field renderer and the
per-pixel renderer. It is ignored by Prettier and is a generated artifact; nothing in the repo depends
on it.

## Headless oracle (Playwright)

The static gallery cannot host WebGL2, so the fourth column is verified against the running app:

```bash
pnpm build
node docs/acceptance/dot-material-lab/verify-dot-lab-oracle.mjs
```

Self-contained like `../dot-surface/verify-dot-surface.mjs` (embedded static server over `dist/`, no
test runner, no repo dependency on Playwright — it expects a playwright install at
`/tmp/dot-verify/node_modules/playwright` or `PLAYWRIGHT_PATH`). It opens `#dot-lab`, presses Compare,
runs the in-page oracle and asserts twelve checks: four slots × 128 cells, the flat control passing
range while failing texture, every field / per-pixel / webgl2 verdict green, painted webgl2 canvases
and a clean console. It exits non-zero on any failure and writes `dot-lab-oracle-*.png` beside
itself.

One environment rule the script encodes: the texture metric is **rasterizer-dependent**. Chromium's
software rasterizer renders the SVG slots slightly softer and field measures ~3.44 — under the 3.5
floor, the same CPU-backend artifact documented in `docs/blob-rendering.md`. The script therefore
launches full Chromium with Metal GPU rasterization (`channel: 'chromium'`); on a GPU-less machine
L10 reports the software numbers as they are.

## Reading it

Every cell can show the **flat reference**: a single radial gradient over the material palette,
deliberately the cheapest possible dot. It is not a renderer and is never shipped. If the engine's
output does not clearly beat it, the engine is not doing its job.

Rasterize the serialized SVG and read the luminance percentiles to compare. The useful number is the
**range** between p5 and p95, not the mean: a dot with a mean that matches the reference and a range
that does not is a flat tint with noise on it.

## What it caught

Every one of these was found by measuring the gallery, not by looking at it.

| Defect                                                               | Symptom measured                                   |
| -------------------------------------------------------------------- | -------------------------------------------------- |
| `HORIZON_LATITUDE` treated latitude 0 as the equator                 | field collapsed; `radiusX`/`radiusY` fell to 1e-6  |
| Light rig placed at 1 radius, on the unit sphere                     | half the body received exactly zero light          |
| Probes marched outside the silhouette                                | 12 of 15 probes identical; ramp range 0.045        |
| `diffuseField * 1.6` saturated the composite                         | range 32 against a flat reference of 135           |
| `feDiffuseLighting` reads `SourceAlpha` as a bump map, not luminance | grey ramp at opacity 1 lit as a flat surface       |
| The filter chain's box was not clipped to the silhouette             | 11 868 lit pixels against a 9 103 pixel silhouette |

The last two are why the per-pixel renderer now writes its height map to **alpha** and clips itself
to the procedural outline over a flat base-colour underlay.

## Current numbers

Luminance range (p5 → p95) averaged over all 64 cells:

| Renderer       | Average range | Min | Max | Lit pixels |
| -------------- | ------------- | --- | --- | ---------- |
| flat reference | 121           | —   | —   | —          |
| `field`        | 62            | 36  | 97  | —          |
| `perPixel`     | 68            | 50  | 95  | 9 024      |

The reference is deliberately left higher: a radial gradient over one colour _is_ smooth, and the
engine's job is not to have a wider range but to have a range that belongs to a lit body. What the
per-pixel pixel count proves is narrower and more important — 9 024 against the 9 103 pixel
silhouette means the filter paints the dot, not its bounding box.

## Cost

See `src/features/rendering/blob/__tests__/blob-perf-test.ts` for the pinned node, filter and
build-time budgets per quality.
