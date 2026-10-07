/**
 * DOT MATERIAL LAB (FASI 41, 42).
 *
 * A tuning harness, not a product surface. The grid is four shape families by
 * eight materials by two lighting setups, which is the matrix that has to stay
 * coherent: a material that only works on a sphere and a light that only works
 * on a sphere are both bugs that a single preview hides.
 *
 * The comparison view is the point of the page. Every cell can show the flat
 * reference — a single radial gradient over the base colour, deliberately the
 * cheapest possible dot — beside the real renderers. If the engine's output
 * does not clearly beat that, it is not doing its job, and the page says so at
 * a glance rather than in a reviewer's memory.
 *
 * The surface field is built once per shape and handed to every cell, because
 * the field depends only on the silhouette: without that a 64-cell grid would
 * resample the surface hundreds of times for nothing.
 */

import { useEffect, useRef, useState } from 'react'

import type { AvatarTextureConfig } from '@bible-strong/avatar-core'

import { createBlobMaterial } from '@/features/rendering/blob'
import { buildSurfaceField, type SurfaceField } from '@/features/rendering/blob/blobSurfaceField'
import { randomizeBlobConfig } from '@/features/rendering/blob/blobRandomize'
import { blobDebugFlags, type BlobDebugFlag } from '@/features/rendering/blob/blobDebug'
import { BlobRenderer } from '@/features/rendering/blob/blobRenderer'
import { DotLabMetrics } from '@/features/rendering/components/DotLabMetrics'
import { disposeLabWebgl, renderLabWebglCell } from '@/features/rendering/dotLabWebgl'
import { hasWebgl2 } from '@/features/rendering/blob/blobWebgl2'
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
import type { BlobConfig } from '@/features/rendering/blob/blobTypes'

/**
 * The control panel: one radial gradient over the base colour.
 *
 * Not a renderer and never shipped. It exists so the grid shows what the
 * material is adding rather than what a coloured circle looks like.
 */
function FlatReference({ config, idPrefix }: { config: BlobConfig; idPrefix: string }) {
  const material = createBlobMaterial(config.material)
  return (
    <svg viewBox="-160 -160 320 320" className="dot-lab-preview" aria-hidden="true">
      <defs>
        <radialGradient id={`${idPrefix}-flat`} cx="35%" cy="30%" r="78%">
          <stop offset="0" stopColor={material.palette.highlight} />
          <stop offset="0.55" stopColor={material.palette.base} />
          <stop offset="1" stopColor={material.palette.shadow} />
        </radialGradient>
      </defs>
      <circle cx="0" cy="0" r={config.shape.radius} fill={`url(#${idPrefix}-flat)`} />
    </svg>
  )
}

type LabMode = 'field' | 'perPixel' | 'webgl2' | 'compare'

const LAB_MODE_LABEL: Record<LabMode, string> = {
  field: 'Field',
  perPixel: 'Per-pixel',
  webgl2: 'WebGL2',
  compare: 'Compare',
}

/**
 * One WebGL2 cell: a 2D canvas painted by the lab's single shared GL
 * context (`dotLabWebgl`). It is a still frame — motion is off in the lab —
 * so one draw per commit is the whole lifecycle; there is no rAF loop here
 * and no React state at all.
 */
function LabWebglCell({ config, texture }: { config: BlobConfig; texture: AvatarTextureConfig }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) renderLabWebglCell(config, canvas, texture)
  })
  return <canvas ref={canvasRef} className="dot-lab-preview" aria-hidden="true" />
}

export function DotMaterialLab() {
  const [mode, setMode] = useState<LabMode>('field')
  const [debug, setDebug] = useState<BlobDebugFlag[]>([])
  const [showFlat, setShowFlat] = useState(true)
  const [seedBump, setSeedBump] = useState(0)
  // One capability decision for the whole page: without WebGL2 the column
  // shows its absence instead of reporting a number it did not produce.
  const [webgl2] = useState(() => hasWebgl2())
  const gridRef = useRef<HTMLDivElement>(null)
  const pose = labRestPose()

  // The shared context belongs to this page, not to the app: releasing it
  // on unmount keeps hash-navigation from leaking a context per visit.
  useEffect(() => () => disposeLabWebgl(), [])

  const fields = new Map<string, SurfaceField>()
  for (const shape of labShapes) {
    const config = labCellConfig(shape, labMaterials[0], labLights[0])
    fields.set(shape.family, buildSurfaceField(pose, labSurfaceConfig(config)))
  }

  // `data-slot` is what the metrics panel reads: it identifies which of the
  // renders a cell is, without the renderer knowing it is measured. The
  // WebGL2 slot is a canvas painted by the shared context; every other slot
  // is SVG and is re-rasterized by the oracle.
  const renderCell = (config: BlobConfig, key: string, slot: 'field' | 'perPixel' | 'webgl2') => (
    <span
      key={key}
      data-slot={slot}
      data-chroma={labMaterialChromatic(config.material) ? '1' : '0'}
    >
      {slot === 'webgl2' ? (
        webgl2 ? (
          <LabWebglCell config={config} texture={labTextureFor(config.material)} />
        ) : (
          <span className="dot-lab-webgl-na">no WebGL2</span>
        )
      ) : (
        <BlobRenderer
          config={config}
          quality={labQuality}
          pose={pose}
          field={fields.get(config.shape.family)}
          idPrefix={key}
          withExpression={false}
          groundShadow={false}
          texture={labTextureFor(config.material)}
          debug={debug}
        />
      )}
    </span>
  )

  return (
    <div className="dot-lab">
      <header className="dot-lab-header">
        <h1>DOT MATERIAL LAB</h1>
        <div className="dot-lab-controls">
          {(['field', 'perPixel', 'webgl2', 'compare'] as const).map(option => (
            <button
              key={option}
              type="button"
              className={mode === option ? 'is-active' : ''}
              onClick={() => setMode(option)}
            >
              {LAB_MODE_LABEL[option]}
            </button>
          ))}
          <label className="dot-lab-toggle">
            <input
              type="checkbox"
              checked={showFlat}
              onChange={event => setShowFlat(event.target.checked)}
            />
            Flat reference
          </label>
          <label className="dot-lab-toggle">
            <input
              type="checkbox"
              checked={debug.length > 0}
              onChange={event => setDebug(event.target.checked ? [...blobDebugFlags] : [])}
            />
            Debug
          </label>
          {debug.length > 0
            ? blobDebugFlags.map(flag => (
                <label key={flag} className="dot-lab-toggle">
                  <input
                    type="checkbox"
                    checked={debug.includes(flag)}
                    onChange={event =>
                      setDebug(current =>
                        event.target.checked
                          ? [...current, flag]
                          : current.filter(entry => entry !== flag)
                      )
                    }
                  />
                  {flag}
                </label>
              ))
            : null}
          <button type="button" onClick={() => setSeedBump(seedBump + 1)}>
            Reroll shapes
          </button>
        </div>
        <p className="dot-lab-hint">
          {labShapes.length} shapes × {labMaterials.length} materials × {labLights.length} lighting
          setups · quality {labQuality} · webgl2 {webgl2 ? 'on' : 'unavailable'} ·{' '}
          <a href="#studio">back to the studio</a>
        </p>
        <DotLabMetrics
          containerRef={gridRef}
          revision={`${seedBump}|${mode}|${showFlat}|${debug.join(',')}`}
        />
      </header>

      <div className="dot-lab-grid" ref={gridRef}>
        {labShapes.map(shape => (
          <section key={shape.family} className="dot-lab-row">
            <h2>{shape.family}</h2>
            <div className="dot-lab-cells">
              {labMaterials.map(materialId =>
                labLights.map(light => {
                  const key = `lab-${shape.family}-${materialId}-${light.id}`
                  const build = (renderer: BlobConfig['renderer']): BlobConfig => {
                    const config = labCellConfig(shape, materialId, light, renderer)
                    // The seed bump re-rolls every silhouette at once, which is
                    // how a family is judged for "is this shape family any good"
                    // rather than for one lucky seed.
                    return seedBump
                      ? randomizeBlobConfig(
                          config,
                          ['shape'],
                          config.shape.seed + seedBump * 104729
                        )
                      : config
                  }
                  const fieldConfig = build('field')
                  const pixelConfig = build('perPixel')
                  // The impostor is its own path — it ignores
                  // `config.renderer` — but it reads the same lab pose the
                  // SVG slots are handed, so the silhouette matches.
                  const webglConfig: BlobConfig = { ...fieldConfig, pose }
                  return (
                    <figure key={key} className="dot-lab-cell">
                      <div className="dot-lab-compare">
                        {showFlat && (
                          <span
                            data-slot="flat"
                            data-chroma={labMaterialChromatic(fieldConfig.material) ? '1' : '0'}
                          >
                            <FlatReference config={fieldConfig} idPrefix={`${key}-flat`} />
                          </span>
                        )}
                        {mode !== 'perPixel' &&
                          mode !== 'webgl2' &&
                          renderCell(fieldConfig, `${key}-field`, 'field')}
                        {mode !== 'field' &&
                          mode !== 'webgl2' &&
                          renderCell(pixelConfig, `${key}-pixel`, 'perPixel')}
                        {(mode === 'webgl2' || mode === 'compare') &&
                          renderCell(webglConfig, `${key}-webgl2`, 'webgl2')}
                      </div>
                      <figcaption>
                        <strong>{materialId}</strong>
                        <span>{shape.family}</span>
                        <span>{light.id}</span>
                        <span>seed {fieldConfig.shape.seed}</span>
                      </figcaption>
                    </figure>
                  )
                })
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
