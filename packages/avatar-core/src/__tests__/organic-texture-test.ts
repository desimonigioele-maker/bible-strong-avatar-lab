import {
  createTextureShader,
  parseSurfaceConfig,
  parseTextureConfig,
  poseFromExpression,
  renderAvatar,
  sameTexture,
  surfacePointAt,
  surfacePresets,
  validateAvatarDefinition,
  type AvatarDefinition,
  type Expression,
  type SurfaceConfig,
} from '../index'

const organicSurface: SurfaceConfig = {
  type: 'blob',
  width: 250,
  height: 235,
  depth: 235,
  roundness: 1,
  seed: 7,
  wobble: 0.14,
}

const sphereSurface: SurfaceConfig = {
  type: 'sphere',
  width: 240,
  height: 240,
  depth: 240,
  roundness: 1,
}

const neutralExpression: Expression = {
  id: 'test-neutral',
  headX: 0,
  headY: 0,
  headZ: 0,
  widthLeft: 28,
  widthRight: 28,
  heightLeft: 38,
  heightRight: 38,
  spacing: 54,
  positionXLeft: 0,
  positionXRight: 0,
  positionYLeft: 0,
  positionYRight: 0,
  leftAngle: 0,
  rightAngle: 0,
  perspective: 1,
  eyeMotion: 'none',
  bodyMotion: 'none',
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
    primary: { type: 'sphere', width: 240, height: 240, depth: 240, roundness: 1 },
    nodes: [],
  },
  colors: { body: '#5b7fe5', eyes: '#111316' },
  expressions: { neutral: definitionExpression },
  expressionOrder: ['neutral'],
  animations: {},
  animationOrder: [],
}

describe('organic avatar surfaces', () => {
  it('displaces blob points away from the ellipsoid baseline', () => {
    const reference = surfacePointAt(sphereSurface, 0.8, 0.3)
    const displaced = surfacePointAt(organicSurface, 0.8, 0.3)
    const distance = Math.hypot(
      displaced[0] - reference[0],
      displaced[1] - reference[1],
      displaced[2] - reference[2]
    )
    expect(distance).toBeGreaterThan(0.5)
  })

  it('stays deterministic for the same seed', () => {
    expect(surfacePointAt(organicSurface, 1.2, -0.4)).toEqual(
      surfacePointAt({ ...organicSurface }, 1.2, -0.4)
    )
    expect(surfacePointAt({ ...organicSurface, seed: 9 }, 1.2, -0.4)).not.toEqual(
      surfacePointAt(organicSurface, 1.2, -0.4)
    )
  })

  it('narrows the drop towards its bottom tip', () => {
    const drop = surfacePresets.drop
    const top = surfacePointAt(drop, Math.PI / 2, Math.PI / 3.4)
    const bottom = surfacePointAt(drop, Math.PI / 2, -Math.PI / 2 + 0.35)
    expect(Math.abs(top[0])).toBeGreaterThan(Math.abs(bottom[0]) * 1.5)
  })

  it('projects a distinct non-trivial silhouette for the flower surface', () => {
    const flower = surfacePresets.flower
    const pose = poseFromExpression(neutralExpression)
    const geometry = renderAvatar(pose, flower, 1)
    const coordinates = geometry.headPath.match(/-?\d+(\.\d+)? -?\d+(\.\d+)?/g) ?? []
    expect(coordinates.length).toBeGreaterThan(40)
    const reference = renderAvatar(pose, sphereSurface, 1)
    expect(geometry.headPath).not.toEqual(reference.headPath)
  })

  it('caches organic samples separately per seed', () => {
    const first = renderAvatar(poseFromExpression(neutralExpression), organicSurface, 1)
    const other = renderAvatar(
      poseFromExpression(neutralExpression),
      { ...organicSurface, seed: 21 },
      1
    )
    expect(first.headPath).not.toEqual(other.headPath)
  })

  it('parses organic fields through parseSurfaceConfig', () => {
    const parsed = parseSurfaceConfig(
      { type: 'blob', width: 250, height: 235, depth: 235, roundness: 1, seed: 3 },
      sphereSurface
    )
    expect(parsed.type).toBe('blob')
    expect(parsed.seed).toBe(3)
    expect(parsed.wobble).toBe(surfacePresets.blob.wobble)
  })
})

describe('avatar textures', () => {
  it('parses texture configs with clamped intensity', () => {
    expect(parseTextureConfig({ type: 'felt', intensity: 3 })).toEqual({
      type: 'felt',
      intensity: 1,
    })
    expect(parseTextureConfig({ type: 'unknown' })).toEqual({ type: 'none' })
    expect(parseTextureConfig(undefined)).toEqual({ type: 'none' })
  })

  it('parses tints leniently: valid hex is lowercased, anything else dropped', () => {
    expect(parseTextureConfig({ type: 'plush', tint: '#AABBCC' })).toEqual({
      type: 'plush',
      tint: '#aabbcc',
    })
    expect(parseTextureConfig({ type: 'plush', tint: 'rebeccapurple' })).toEqual({ type: 'plush' })
    expect(parseTextureConfig({ type: 'plush', tint: 42 })).toEqual({ type: 'plush' })
    expect(
      sameTexture({ type: 'plush', tint: '#ff0000' }, { type: 'plush', tint: '#ff0000' })
    ).toBe(true)
    expect(sameTexture({ type: 'plush', tint: '#ff0000' }, { type: 'plush' })).toBe(false)
  })

  it('paints the plush nap in the tint colour instead of white', () => {
    const plain = createTextureShader({ type: 'plush' }, 'clip', 'inst')
    const tinted = createTextureShader({ type: 'plush', tint: '#4c8dfb' }, 'clip', 'inst')
    // Untinted fur is a white film: rgb constants 1,1,1 with alpha 1.4*turb.
    expect(plain.defs).toContain('0 0 0 0 1 0 0 0 0 1 0 0 0 0 1')
    expect(plain.defs).toContain('stop-color="#ffffff"')
    expect(tinted.defs).not.toContain('0 0 0 0 1 0 0 0 0 1')
    expect(tinted.defs).toContain('0 0 0 0 0.298 0 0 0 0 0.553 0 0 0 0 0.984')
    expect(tinted.defs).toContain('stop-color="#4c8dfb"')
    // The dark depth gradient stays black: tinting the shadow would tint the
    // tonal range the material is measured on.
    expect(tinted.defs).toContain('stop-color="#000000"')
  })

  it('returns empty shader for none', () => {
    const shader = createTextureShader({ type: 'none' }, 'clip', 'instance')
    expect(shader).toEqual({ defs: '', underEye: '', top: '' })
  })

  it('builds deterministic overlay markup referencing the clip id', () => {
    const felt = createTextureShader({ type: 'felt', intensity: 0.4 }, 'my-clip', 'inst1')
    const again = createTextureShader({ type: 'felt', intensity: 0.4 }, 'my-clip', 'inst1')
    expect(felt).toEqual(again)
    expect(felt.underEye).toContain('url(#my-clip)')
    expect(felt.underEye).toContain('inst1')
    expect(felt.defs).toContain('feTurbulence')
  })

  it('exposes a glow filter for the neon finish only', () => {
    const neon = createTextureShader({ type: 'neon' }, 'clip', 'inst')
    const glossy = createTextureShader({ type: 'glossy' }, 'clip', 'inst')
    expect(neon.glowFilterId).toBeTruthy()
    expect(glossy.glowFilterId).toBeUndefined()
    expect(glossy.underEye).toContain('ellipse')
    expect(glossy.top).toContain('bs-tex-floor-inst')
    expect(glossy.defs).toContain('linearGradient')
  })

  it('validates definitions carrying textures and organic surfaces', () => {
    const result = validateAvatarDefinition({
      ...baseDefinition,
      body: {
        primary: { type: 'blob', width: 250, height: 235, depth: 235, roundness: 1, seed: 7 },
        nodes: [
          {
            surface: { type: 'flower', width: 120, height: 120, depth: 100, roundness: 1 },
            position: [0, -40, 60],
            rotation: [0, 0, 0],
          },
        ],
      },
      colors: {
        body: '#5b7fe5',
        eyes: '#111316',
        texture: { type: 'plush', intensity: 0.7 },
      },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects unknown texture types through the schema', () => {
    const result = validateAvatarDefinition({
      ...baseDefinition,
      colors: {
        body: '#5b7fe5',
        eyes: '#111316',
        texture: { type: 'silk' },
      },
    })
    expect(result.ok).toBe(false)
  })
})
