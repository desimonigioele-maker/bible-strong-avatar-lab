/**
 * Live measurement panel for the DOT MATERIAL LAB (FASE A).
 *
 * The lab already lets a reviewer *look* at sixty-four dots. Looking was not
 * enough: the body was measurably flatter than a plain radial gradient and
 * nobody saw it, because the eye compares a dot to the other dots in the grid
 * rather than to the cheapest possible control.
 *
 * So this panel rasterizes what is actually on screen and prints the three
 * numbers that separate a modelled surface from a coloured circle: chroma
 * retained, tonal range kept, grain still present. It reads the grid through
 * one container ref and `data-slot` markers, so the page does not have to
 * thread a ref through every renderer and no render path knows it is measured.
 *
 * Measurement is opt-in because it costs a canvas raster per cell: a reviewer
 * who wants numbers presses the button, a reviewer who wants to look does not
 * have to pay for it.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'

import {
  formatMetrics,
  referenceTargets,
  summarize,
  verdictOf,
  type DotMetrics,
} from '../dotLabMetrics'
import { rasterizeSvg, readRasterCanvas } from '../dotLabRaster'

export type LabSlot = 'flat' | 'field' | 'perPixel' | 'webgl2'

type SlotSummary = {
  slot: LabSlot
  metrics: DotMetrics
  cells: number
}

const SLOT_LABEL: Record<LabSlot, string> = {
  flat: 'flat control',
  field: 'field',
  perPixel: 'per-pixel',
  webgl2: 'webgl2',
}

const SLOT_ORDER: LabSlot[] = ['flat', 'field', 'perPixel', 'webgl2']

const mark = (pass: boolean) => (pass ? '✓' : '✕')

const MetricRow = ({
  label,
  value,
  target,
  digits,
  pass,
}: {
  label: string
  value: number
  target: number
  digits: number
  pass: boolean
}) => (
  <span className={`dot-lab-metric${pass ? ' is-pass' : ' is-fail'}`}>
    <span className="dot-lab-metric-label">{label}</span>
    <span className="dot-lab-metric-value">
      {value.toFixed(digits)}/{target.toFixed(digits)}
    </span>
    <span className="dot-lab-metric-mark">{mark(pass)}</span>
  </span>
)

/** Averages one slot and reports it against the reference targets. */
const SlotReport = ({ summary }: { summary: SlotSummary }) => {
  const verdict = verdictOf(summary.metrics)
  return (
    <div className="dot-lab-slot-report">
      <strong>
        {SLOT_LABEL[summary.slot]} <em>{summary.cells}</em>
      </strong>
      <MetricRow
        label="sat"
        value={summary.metrics.saturation}
        target={referenceTargets.saturation}
        digits={3}
        pass={verdict.saturation}
      />
      <MetricRow
        label="rng"
        value={summary.metrics.range}
        target={referenceTargets.range}
        digits={1}
        pass={verdict.range}
      />
      <MetricRow
        label="tex"
        value={summary.metrics.texture}
        target={referenceTargets.texture}
        digits={2}
        pass={verdict.texture}
      />
    </div>
  )
}

export type DotLabMetricsProps = {
  /** The grid element; cells are found through `[data-slot]`. */
  containerRef: RefObject<HTMLElement | null>
  /**
   * Identifies the current contents of the grid.
   *
   * When it changes the report is dropped rather than left on screen: a
   * number measured against a grid the user has since re-rolled or filtered is
   * worse than no number, because it looks authoritative.
   */
  revision: string
}

export function DotLabMetrics({ containerRef, revision }: DotLabMetricsProps) {
  const [summaries, setSummaries] = useState<SlotSummary[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  // A run can outlive the grid it started from; the token makes a late result
  // write into a report nobody is looking at impossible.
  const token = useRef(0)

  useEffect(() => {
    setSummaries([])
    setError('')
    token.current += 1
  }, [revision])

  const measure = async () => {
    const run = token.current + 1
    token.current = run
    setRunning(true)
    setError('')

    const root = containerRef.current
    const slots = root ? [...root.querySelectorAll<HTMLElement>('[data-slot]')] : []

    if (slots.length === 0) {
      setRunning(false)
      setError('nessuna cella da misurare')
      return
    }

    const bySlot = new Map<LabSlot, DotMetrics[]>()
    // Saturation is aggregated over chromatic materials only (see
    // neutralMaterialChroma): neutral cells still count for range and texture.
    const chromaSaturation = new Map<LabSlot, number[]>()
    let measured = 0

    for (const holder of slots) {
      const slot = holder.dataset.slot as LabSlot | undefined
      if (!slot) continue
      // The WebGL2 column is pixels already (one shared context blitted into
      // a 2D canvas); the SVG slots are re-rasterized. Canvas is checked
      // first so a WebGL cell is never measured through the wrong path.
      const canvas = holder.querySelector('canvas')
      const svg = holder.querySelector('svg')
      const metric = canvas ? readRasterCanvas(canvas) : svg ? await rasterizeSvg(svg) : null
      // One unreadable cell must not blank the report: it is skipped and the
      // remaining cells still average together.
      if (!metric || metric.samples === 0) continue
      if (token.current !== run) return
      const bucket = bySlot.get(slot) ?? []
      bucket.push(metric)
      bySlot.set(slot, bucket)
      if (holder.dataset.chroma === '1') {
        const sats = chromaSaturation.get(slot) ?? []
        sats.push(metric.saturation)
        chromaSaturation.set(slot, sats)
      }
      measured += 1
    }

    if (token.current !== run) return
    setRunning(false)
    if (measured === 0) {
      setError('nessuna cella misurabile')
      return
    }

    const next: SlotSummary[] = []
    for (const slot of SLOT_ORDER) {
      const bucket = bySlot.get(slot)
      if (!bucket || bucket.length === 0) continue
      const sats = chromaSaturation.get(slot) ?? []
      const saturation =
        sats.length === 0 ? 0 : sats.reduce((total, value) => total + value, 0) / sats.length
      const averaged = summarize(bucket)
      next.push({
        slot,
        metrics: { ...averaged, saturation },
        cells: bucket.length,
      })
    }
    setSummaries(next)
  }

  const last = summaries[summaries.length - 1]

  return (
    <div className="dot-lab-metrics" aria-live="polite">
      <div className="dot-lab-metrics-head">
        <span className="dot-lab-metrics-title">Misura</span>
        <button type="button" onClick={() => void measure()} disabled={running}>
          {running ? 'Misuro…' : 'Misura le celle'}
        </button>
        {summaries.length > 0 && (
          <span className="dot-lab-metrics-hint">
            soglie dal riferimento: sat ≥ {referenceTargets.saturation} (soli materiali cromatici) ·
            rng ≥ {referenceTargets.range} · tex ≥ {referenceTargets.texture}
          </span>
        )}
        {error ? <span className="dot-lab-metrics-error">{error}</span> : null}
      </div>
      {last ? (
        <div className="dot-lab-metrics-body">
          {summaries.map(summary => (
            <SlotReport key={summary.slot} summary={summary} />
          ))}
          <span className="dot-lab-metrics-note">ultima slot: {formatMetrics(last.metrics)}</span>
        </div>
      ) : null}
    </div>
  )
}
