# Dot surface — acceptance evidence

Artifacts for the WebGL `dot` body surface (OpenAI-dots-style blob). The
acceptance grid A1–A7 from the original brief is fully green
(12/12 checks, including the A8 softness-selector extras and the A5
standalone-export runtime).

## Screenshots

| File                            | What it shows                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `dots-acceptance-0-entry.png`   | Studio avatars page before entering the body editor                                                                              |
| `dots-acceptance-1-blob*.png`   | Blob with default dot parameters — `-before` = classic preset, `-softer` = softer preset, plain = plush preset (current default) |
| `dots-acceptance-3-purple*.png` | Same three softness stages after switching the dot color to `#7c5cff`                                                            |
| `dots-acceptance-5-export.png`  | The generated standalone export rendering its dot scene offline in Chromium                                                      |

## Scripts

Both scripts are self-contained: they embed their own static file server and
resolve Playwright from `PLAYWRIGHT_PATH` (default
`/tmp/dot-verify/node_modules/playwright`, installed with
`npm install playwright` there; browsers live in
`~/Library/Caches/ms-playwright`).

```sh
# 1. Production build (from the repo root, pnpm 10 via corepack)
corepack pnpm exec vite build

# 2. Generate the standalone export fixture used by check A5
EXPORT_FIXTURE_DIR=/tmp/dot-verify/export \
  corepack pnpm exec vitest run export-fixture-test

# 3. Full acceptance run (12 checks; writes screenshots next to this README)
PLAYWRIGHT_PATH=/tmp/dot-verify/node_modules/playwright \
  node docs/acceptance/dot-surface/verify-dot-surface.mjs

# Optional: pixel metrics across the classic/softer/plush screenshots
node docs/acceptance/dot-surface/compare-softness.mjs
```

## Check list

- **A1** dot surface shows the WebGL canvas (SVG layer stays for hit-testing)
- **A2** the canvas owns a live WebGL context
- **A3** dot color change reaches the persisted document (after Save)
- **A4** reload restores `"dot"` with color + softness from localStorage
- **A5a–c** the exported `avatar.js` mounts the dot WebGL scene offline,
  exposes the `play`/`destroy` API and boots with a clean console
- **A6** SVG surfaces still render (regression baseline)
- **A7** no console errors/warnings in the studio (GL driver noise filtered)
- **A8/A8b** softness selector switches presets and persists
- Photo Mode captures the dot scene to a PNG download

Pixel metrics (classic → softer → plush): blob mean luminance 0.2755 → 0.2764
→ 0.2805 with highlight share 0.93% → 0.96% → 1.74%; the purple scene turns
darker with a border-hugging SSS glow (−0.6% luminance), i.e. the light
transport visibly changes rather than mere highlight gain.
