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

import { useRef, useState } from 'react'

import { createBlobMaterial } from '@/features/rendering/blob'
import { buildSurfaceField, type SurfaceField } from '@/features/rendering/blob/blobSurfaceField'
import { randomizeBlobConfig } from '@/features/rendering/blob/blobRandomize'
import { blobDebugFlags, type BlobDebugFlag } from '@/features/rendering/blob/blobDebug'
import { BlobRenderer } from '@/features/rendering/blob/blobRenderer'
import { DotLabMetrics } from '@/features/rendering/components/DotLabMetrics'
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

type LabMode = 'field' | 'perPixel' | 'compare'

export function DotMaterialLab() {
  const [mode, setMode] = useState<LabMode>('field')
  const [debug, setDebug] = useState<BlobDebugFlag[]>([])
  const [showFlat, setShowFlat] = useState(true)
  const [seedBump, setSeedBump] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const pose = labRestPose()

  const fields = new Map<string, SurfaceField>()
  for (const shape of labShapes) {
    const config = labCellConfig(shape, labMaterials[0], labLights[0])
    fields.set(shape.family, buildSurfaceField(pose, labSurfaceConfig(config)))
  }

  // `data-slot` is what the metrics panel reads: it identifies which of the
  // three renders a cell is, without the renderer knowing it is measured.
  const renderCell = (config: BlobConfig, key: string, slot: 'field' | 'perPixel') => (
    <span
      key={key}
      data-slot={slot}
      data-chroma={labMaterialChromatic(config.material) ? '1' : '0'}
    >
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
    </span>
  )

  return (
    <div className="dot-lab">
      <header className="dot-lab-header">
        <h1>DOT MATERIAL LAB</h1>
        <div className="dot-lab-controls">
          {(['field', 'perPixel', 'compare'] as const).map(option => (
            <button
              key={option}
              type="button"
              className={mode === option ? 'is-active' : ''}
              onClick={() => setMode(option)}
            >
              {option === 'field' ? 'Field' : option === 'perPixel' ? 'Per-pixel' : 'Compare'}
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
          setups · quality {labQuality} · <a href="#studio">back to the studio</a>
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
                  return (
                    <figure key={key} className="dot-lab-cell">
                      <div className="dot-lab-compare">
                        {showFlat && (
                          <span data-slot="flat">
                            <FlatReference config={fieldConfig} idPrefix={`${key}-flat`} />
                          </span>
                        )}
                        {mode !== 'perPixel' && renderCell(fieldConfig, `${key}-field`, 'field')}
                        {mode !== 'field' && renderCell(pixelConfig, `${key}-pixel`, 'perPixel')}
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
