/**
 * The DOT surface rename guard.
 *
 * `blob2d` was the name of the rejected implementation. The type, the params
 * field and every symbol that spelled it are now `softDot`, and the only place
 * the old word survives is as a read alias — a document exported before the
 * rename has to keep opening. These tests pin both halves of that: the new name
 * is canonical, and the old one is understood exactly once and then erased.
 */

import {
  defaultSoftDotParams,
  primarySurfaceTypes,
  surfaceLabels,
  surfacePresets,
} from '@bible-strong/avatar-core'
import { parseSurfaceConfig } from '../body'

const softDotPayload = {
  type: 'softDot',
  width: 250,
  height: 250,
  depth: 250,
  roundness: 1,
  softDot: { ...defaultSoftDotParams, seed: 4242, renderer: 'perPixel' },
}

describe('softDot surface', () => {
  it('is the canonical name in the type list, the preset and the labels', () => {
    expect(Object.keys(surfacePresets)).toContain('softDot')
    expect(Object.keys(surfacePresets)).not.toContain('blob2d')
    expect(primarySurfaceTypes).toContain('softDot')
    expect(primarySurfaceTypes).not.toContain('blob2d')
    expect(surfacePresets.softDot.type).toBe('softDot')
    expect(surfaceLabels.softDot).toBe('DOT soft')
  })

  it('parses and round-trips its own documents unchanged', () => {
    const parsed = parseSurfaceConfig(softDotPayload, surfacePresets.sphere)
    expect(parsed.type).toBe('softDot')
    expect(parsed.softDot?.seed).toBe(4242)
    expect(parsed.softDot?.renderer).toBe('perPixel')
    expect('blob2d' in parsed).toBe(false)
  })

  it('still loads a document written before the rename, and rewrites it', () => {
    const { softDot, ...legacy } = softDotPayload
    const parsed = parseSurfaceConfig(
      { ...legacy, type: 'blob2d', blob2d: softDot },
      surfacePresets.sphere
    )
    expect(parsed.type).toBe('softDot')
    expect(parsed.softDot?.seed).toBe(4242)
    // The legacy field must not survive: the next save writes softDot.
    expect('blob2d' in parsed).toBe(false)
  })

  it('prefers softDot when a document somehow carries both', () => {
    const parsed = parseSurfaceConfig(
      {
        ...softDotPayload,
        softDot: { ...defaultSoftDotParams, seed: 1 },
        blob2d: { ...defaultSoftDotParams, seed: 2 },
      },
      surfacePresets.sphere
    )
    expect(parsed.softDot?.seed).toBe(1)
  })

  it('rejects malformed DOT parameters instead of silently repairing them', () => {
    const parsed = parseSurfaceConfig(
      { ...softDotPayload, softDot: { ...defaultSoftDotParams, color: 'not-a-colour' } },
      surfacePresets.sphere
    )
    expect(parsed.type).toBe('sphere')
  })
})
