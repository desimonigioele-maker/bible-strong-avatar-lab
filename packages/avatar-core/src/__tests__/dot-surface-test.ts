import {
  parseAvatarDefinition,
  parseDotParams,
  surfacePresets,
  surfacePointAt,
  validateAvatarDefinition,
  type AvatarDefinition,
  type DotSoftness,
} from '../index'

const dotParams = {
  color: '#ff2fb4',
  wobble: 0.055,
  sssColor: '#ff77cf',
  sssStrength: 0.7,
  eyeOffsetX: 0.02,
  eyeOffsetY: -0.03,
  seed: 7,
  softness: 'softer' as const,
}

const definitionExpression = {
  head: { x: 0, y: 0, z: 0 },
  eyes: {
    left: { width: 28, height: 38, x: 0, y: 0, angle: 0 },
    right: { width: 28, height: 38, x: 0, y: 0, angle: 0 },
    spacing: 54,
  },
  perspective: 1,
  motion: { eyes: 'none', body: 'none' },
} as const

const baseDefinition: AvatarDefinition = {
  schema: 'bible-strong/avatar-definition',
  schemaVersion: 1,
  body: {
    primary: { type: 'dot', width: 240, height: 240, depth: 240, roundness: 1, dot: dotParams },
    nodes: [],
  },
  colors: { body: '#5b7fe5', eyes: '#111316' },
  expressions: { neutral: definitionExpression },
  expressionOrder: ['neutral'],
  animations: {},
  animationOrder: [],
}

describe('dot surface definition', () => {
  it('validates a definition whose primary surface is a dot with parameters', () => {
    const result = validateAvatarDefinition(baseDefinition)
    expect(result.ok).toBe(true)
  })

  it('round-trips dot parameters through parse/serialize', () => {
    const source = JSON.stringify(baseDefinition)
    const parsed = parseAvatarDefinition(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body.primary.type).toBe('dot')
    expect(parsed.value.body.primary.dot).toEqual(dotParams)
  })

  it('rejects dot parameters with invalid colors or non-finite numbers', () => {
    const invalidColor = validateAvatarDefinition({
      ...baseDefinition,
      body: {
        ...baseDefinition.body,
        primary: {
          type: 'dot',
          width: 240,
          height: 240,
          depth: 240,
          roundness: 1,
          dot: { ...dotParams, color: 'hotpink' },
        },
      },
    })
    expect(invalidColor.ok).toBe(false)

    const invalidNumber = validateAvatarDefinition({
      ...baseDefinition,
      body: {
        ...baseDefinition.body,
        primary: {
          type: 'dot',
          width: 240,
          height: 240,
          depth: 240,
          roundness: 1,
          dot: { ...dotParams, seed: Number.NaN },
        },
      },
    })
    expect(invalidNumber.ok).toBe(false)

    const invalidSoftness = validateAvatarDefinition({
      ...baseDefinition,
      body: {
        ...baseDefinition.body,
        primary: {
          type: 'dot',
          width: 240,
          height: 240,
          depth: 240,
          roundness: 1,
          dot: { ...dotParams, softness: 'cotton' as unknown as DotSoftness },
        },
      },
    })
    expect(invalidSoftness.ok).toBe(false)
  })

  it('keeps legacy dot parameters without softness and parses an explicit one', () => {
    const { softness: _softness, ...legacyParams } = dotParams
    expect(parseDotParams(legacyParams)).toStrictEqual(legacyParams)
    expect(parseDotParams(dotParams)).toStrictEqual(dotParams)
    expect(
      parseDotParams({ ...dotParams, softness: 'cotton' as unknown as DotSoftness })
    ).toBeUndefined()
  })

  it('clamps out-of-range dot parameters when parsing surface configs', () => {
    const parsed = surfacePresets.dot
    expect(parsed.dot).toEqual({
      color: '#ff2fb4',
      wobble: 0.055,
      sssColor: '#ff77cf',
      sssStrength: 0.95,
      eyeOffsetX: 0,
      eyeOffsetY: 0,
      seed: 1,
      softness: 'plush',
    })
  })

  it('keeps the SVG-side dot silhouette a smooth ellipsoid for eye placement', () => {
    const top = surfacePointAt(surfacePresets.dot, Math.PI / 2, Math.PI / 2)
    const sideX = surfacePointAt(surfacePresets.dot, Math.PI / 2, 0)
    const sideZ = surfacePointAt(surfacePresets.dot, 0, 0)
    expect(top[1]).toBeCloseTo(surfacePresets.dot.height / 2, 5)
    expect(sideX[0]).toBeCloseTo(surfacePresets.dot.width / 2, 5)
    expect(sideZ[2]).toBeCloseTo(surfacePresets.dot.depth / 2, 5)
  })
})
