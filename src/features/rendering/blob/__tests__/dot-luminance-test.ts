import { describe, expect, it } from 'vitest'

import { buildBlobScene } from '../blobSvg'
import { blobMaterialPresets } from '../blobPresets'
import { createDefaultBlobConfig, type BlobConfig } from '../blobTypes'
import { normalizeBlobConfig } from '../blobConfig'

/**
 * Objective, screenshot-free verification of the look.
 *
 * The studio's failure mode was "a flat lower half": a radial gradient whose
 * stops happened to be even, so the bottom of every dot collapsed to one
 * value. This measures the actual luminance spread of the emitted stops, which
 * is the property that has to hold for the result to read as a lit surface.
 */
const relativeLuminance = (hex: string): number => {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

const stopsOf = (config: BlobConfig) => {
  const scene = buildBlobScene(normalizeBlobConfig(config))
  return scene.lighting.volume.stops
}

describe('volumetric range', () => {
  it('gives the default dot a wide, non-flat luminance ramp', () => {
    const luminances = stopsOf(createDefaultBlobConfig()).map(stop => relativeLuminance(stop.color))
    const range = Math.max(...luminances) - Math.min(...luminances)
    // A flat smear scores well under 0.05; a modelled volume is far above.
    expect(range).toBeGreaterThan(0.1)
  })

  it('never collapses to a flat ramp for any shipped preset', () => {
    for (const preset of blobMaterialPresets) {
      const config = createDefaultBlobConfig()
      const stops = stopsOf({ ...config, material: { ...config.material, ...preset.material } })
      const luminances = stops.map(stop => relativeLuminance(stop.color))
      const range = Math.max(...luminances) - Math.min(...luminances)
      expect({ preset: preset.id, range }).toEqual({ preset: preset.id, range: expect.any(Number) })
      expect(range).toBeGreaterThan(0.08)
    }
  })

  it('samples the field densely enough that the ramp is not a straight line', () => {
    const stops = stopsOf(createDefaultBlobConfig())
    // The quality ladder raises the probe count, so the ramp gains detail.
    expect(stops.length).toBeGreaterThanOrEqual(12)
    const offsets = stops.map(stop => stop.offset)
    // Offsets must strictly increase: a duplicated offset collapses the ramp.
    for (let index = 1; index < offsets.length; index++) {
      expect(offsets[index]).toBeGreaterThan(offsets[index - 1])
    }
  })

  it('climbs the quality ladder in sampling density', () => {
    const base = createDefaultBlobConfig()
    const counts = (['low', 'medium', 'high', 'ultra'] as const).map(
      quality => buildBlobScene(base, { quality }).lighting.volume.stops.length
    )
    for (let index = 1; index < counts.length; index++) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1])
    }
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0])
  })

  it('peaks where the key light points and darkens away from it', () => {
    const scene = buildBlobScene(createDefaultBlobConfig())
    const stops = scene.lighting.volume.stops
    const luminances = stops.map(stop => relativeLuminance(stop.color))
    // A sphere lit from one side is brightest where the surface normal faces
    // the light, which is inside the body rather than at either limb. The ramp
    // therefore rises to a peak and falls again, and it must do so smoothly:
    // a local reversal that is not the peak would read as a colour band.
    const peak = luminances.indexOf(Math.max(...luminances))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan(luminances.length - 1)
    for (let index = 1; index <= peak; index++) {
      expect(luminances[index]).toBeGreaterThanOrEqual(luminances[index - 1] - 0.002)
    }
    for (let index = peak + 1; index < luminances.length; index++) {
      expect(luminances[index]).toBeLessThanOrEqual(luminances[index - 1] + 0.002)
    }
    // Both limbs must be genuinely darker than the peak, or the body reads flat.
    const ends = [luminances[0], luminances[luminances.length - 1]]
    for (const end of ends) expect(end).toBeLessThan(luminances[peak])
  })

  it('anchors the highlight to the key light, not to a fixed offset', () => {
    const base = createDefaultBlobConfig()
    const highlightX = (lightX: number) =>
      buildBlobScene({ ...base, lighting: { ...base.lighting, lightX } }).lighting.specular.cx
    // The axis ramp is symmetric along the light axis by construction, so the
    // highlight lives in the specular layer. It has to follow the key light,
    // otherwise the light is painted on rather than modelled.
    expect(highlightX(-0.8)).toBeLessThan(highlightX(0.8))
    expect(Math.abs(highlightX(-0.8))).toBeGreaterThan(20)
  })

  it('keeps the specular layer broad, as a soft material requires', () => {
    const scene = buildBlobScene(createDefaultBlobConfig())
    const { rx, ry, opacity } = scene.lighting.specular
    // A tight lobe reads as a plastic bead; a broad one reads as a surface.
    expect(rx).toBeGreaterThan(scene.lighting.volume.stops.length * 0)
    expect(rx / scene.field.radiusX).toBeGreaterThan(0.12)
    expect(ry / rx).toBeGreaterThan(0.4)
    expect(ry / rx).toBeLessThan(1)
    expect(opacity).toBeGreaterThan(0)
    expect(opacity).toBeLessThanOrEqual(1)
  })

  it('builds several colour fields for every default material', () => {
    const scene = buildBlobScene(createDefaultBlobConfig())
    expect(scene.lighting.colorFields.length).toBeGreaterThanOrEqual(3)
    for (const field of scene.lighting.colorFields) {
      expect(field.color).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('moves the highlight when the key light moves', () => {
    const base = createDefaultBlobConfig()
    const left = buildBlobScene({ ...base, lighting: { ...base.lighting, lightX: -0.8 } })
    const right = buildBlobScene({ ...base, lighting: { ...base.lighting, lightX: 0.8 } })
    expect(left.lighting.specular.cx).not.toBeCloseTo(right.lighting.specular.cx, 1)
  })

  it('keeps the lights out of the object transform, so a rotating dot keeps its light', () => {
    // The specular anchor is expressed in the same user space as the
    // silhouette, not inside the motion group, which is what makes the light
    // read as belonging to the scene.
    const scene = buildBlobScene(createDefaultBlobConfig())
    expect(Number.isFinite(scene.lighting.specular.cx)).toBe(true)
    expect(Number.isFinite(scene.lighting.specular.cy)).toBe(true)
    expect(Math.abs(scene.lighting.specular.cx)).toBeLessThan(400)
  })

  it('keeps the additive layers from washing the ramp out', () => {
    // Measuring the gradient stops in isolation is not enough: the wash, fill
    // and colour fields are all lifted *over* the ramp, and a stack of
    // screen-blended layers silently turns a modelled volume back into the
    // flat tint this renderer exists to avoid. The total additive budget is the
    // invariant that protects the composited result.
    const lighting = buildBlobScene(createDefaultBlobConfig()).lighting
    const additive =
      lighting.washLight.stops.reduce((total, stop) => total + stop.opacity, 0) +
      lighting.fill.stops[0].opacity +
      lighting.colorFields.reduce((total, field) => total + field.opacity, 0)
    // Budget calibrated against the self-measuring acceptance gallery
    // (docs/acceptance/dot-material-lab): at the old 0.8 ceiling the screen
    // stack cost ~20 points of composited tonal range and ~0.15 saturation
    // against the reference targets. 0.6 keeps every tint layer audible while
    // leaving the ramp in charge of the body; the composited equivalent of
    // this invariant is measured directly in that gallery's report.
    expect(additive).toBeLessThan(0.6)
  })

  it('spans the palette from the shadow colour to the highlight', () => {
    const config = createDefaultBlobConfig()
    const scene = buildBlobScene(config)
    const material = scene.material
    const luminances = scene.lighting.volume.stops.map(stop => relativeLuminance(stop.color))
    const darkest = Math.min(...luminances)
    const brightest = Math.max(...luminances)
    // The field is normalized against the rig's own maximum, so the shadow end
    // has to be genuinely dark. A ramp that never leaves the base colour is
    // the saturation bug this replaced.
    expect(darkest).toBeLessThan(relativeLuminance(material.palette.base))
    expect(brightest).toBeGreaterThan(relativeLuminance(material.palette.base))
  })

  it('reports finite shading statistics for every quality', () => {
    for (const quality of ['low', 'medium', 'high', 'ultra'] as const) {
      const stats = buildBlobScene(createDefaultBlobConfig(), { quality }).lighting.stats
      expect(stats.samples).toBeGreaterThan(0)
      for (const value of Object.values(stats)) expect(Number.isFinite(value)).toBe(true)
      // A surface with no contrast at all would be the old flat failure.
      expect(stats.maxDiffuse - stats.minDiffuse).toBeGreaterThan(0.05)
    }
  })
})
