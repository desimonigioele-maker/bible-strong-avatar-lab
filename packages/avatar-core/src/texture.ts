/**
 * SVG texture "shaders" for avatar bodies.
 *
 * Textures are rendered as static overlay layers (gradients, noise filters,
 * glow) that blend on top of the flat body fills. Because the overlays are
 * color-independent, the underlying fills stay frame-accurate: expression
 * color overrides and animated color interpolation keep working while the
 * material finish sits on top.
 *
 * All markup is deterministic for a given texture, clip id and instance id,
 * so rendered scenes stay stable across frames and snapshots.
 */

export type AvatarTextureType = 'none' | 'felt' | 'plush' | 'glossy' | 'neon'

export type AvatarTextureConfig = {
  type: AvatarTextureType
  /** Grain / fur / glow density, 0 to 1. Defaults to 0.55 (0.8 for neon). */
  intensity?: number
  /**
   * Optional `#rrggbb` colour for the light-catching layers (the fur strands,
   * the soft-light gradient). Unset keeps them white, which is right for a
   * studio finish over any colour — except when the finish is the material's
   * own nap: white fur frosts the body underneath (measured: −0.13 saturation
   * and the shadow side loses its depth), while a tinted nap keeps the colour
   * and reads as the same fabric as the reference artwork.
   */
  tint?: string
}

export const avatarTextureTypes: AvatarTextureType[] = ['none', 'felt', 'plush', 'glossy', 'neon']

export const defaultTexture: AvatarTextureConfig = { type: 'none' }

export const textureLabels: Record<AvatarTextureType, string> = {
  none: 'Aucune',
  felt: 'Feutrine',
  plush: 'Peluche',
  glossy: 'Brillant',
  neon: 'Néon',
}

export const isAvatarTextureType = (value: unknown): value is AvatarTextureType =>
  typeof value === 'string' && avatarTextureTypes.includes(value as AvatarTextureType)

/** Accepts `#rrggbb`; anything else is dropped rather than rejected. */
export const parseTextureTint = (value: unknown): string | undefined =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : undefined

export const parseTextureConfig = (value: unknown): AvatarTextureConfig => {
  if (!value || typeof value !== 'object') return { ...defaultTexture }
  const candidate = value as Partial<AvatarTextureConfig>
  if (!isAvatarTextureType(candidate.type)) return { ...defaultTexture }
  const intensity =
    typeof candidate.intensity === 'number' && Number.isFinite(candidate.intensity)
      ? Math.max(0, Math.min(1, candidate.intensity))
      : undefined
  const tint = parseTextureTint(candidate.tint)
  return {
    type: candidate.type,
    ...(intensity === undefined ? {} : { intensity }),
    ...(tint === undefined ? {} : { tint }),
  }
}

export const sameTexture = (left: AvatarTextureConfig, right: AvatarTextureConfig) =>
  left.type === right.type &&
  (left.intensity ?? -1) === (right.intensity ?? -1) &&
  (left.tint ?? '') === (right.tint ?? '')

export type TextureShader = {
  /** Static defs markup: gradients and filters with resolved ids. */
  defs: string
  /** Overlay layers rendered right after the head path, under the eyes. */
  underEye: string
  /** Overlay layers rendered above every body path, including front nodes. */
  top: string
  /** When set, renderers duplicate the head path under the body with this filter id for an outer glow. */
  glowFilterId?: string
}

/**
 * Builds the texture shader. `clipId` must reference a clipPath whose shape is
 * the body outline; `instanceId` keeps ids unique when several avatars share
 * one document.
 */
export const createTextureShader = (
  texture: AvatarTextureConfig,
  clipId: string,
  instanceId: string
): TextureShader => {
  if (texture.type === 'none') return { defs: '', underEye: '', top: '' }
  const intensity = Math.max(
    0,
    Math.min(1, texture.intensity ?? (texture.type === 'neon' ? 0.8 : 0.55))
  )
  const id = (suffix: string) => `bs-tex-${suffix}-${instanceId}`
  const number = (value: number) => value.toFixed(3)
  const tint = parseTextureTint(texture.tint) ?? '#ffffff'
  const tintRgb = [
    Number.parseInt(tint.slice(1, 3), 16) / 255,
    Number.parseInt(tint.slice(3, 5), 16) / 255,
    Number.parseInt(tint.slice(5, 7), 16) / 255,
  ]
  // A white tint keeps the historic markup byte-for-byte (`1`, not `1.000`):
  // the default avatar's shader output must not move because of an option it
  // does not use.
  const channel = (value: number) => (value === 1 ? '1' : number(value))
  // Overlay rectangles cover the whole canvas; the body clip constrains them.
  const rect = (fill: string, extra = '') =>
    `<rect x="-150" y="-150" width="300" height="300" fill="${fill}" ${extra}/>`
  const clipped = (markup: string) =>
    `<g clip-path="url(#${clipId})" pointer-events="none">${markup}</g>`
  // Blends happen against the flat body fills painted earlier in the same
  // isolated group (the renderer wraps body content in isolation:isolate).
  const blend = (mode: string) => `style="mix-blend-mode:${mode}"`

  const depthShade = (clipMarkup: string) =>
    clipped(
      `<radialGradient id="${id('dark')}" cx="50%" cy="42%" r="72%">` +
        `<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="#000000" stop-opacity="${number(0.2 + 0.26 * intensity)}"/>` +
        `</radialGradient>` +
        `<radialGradient id="${id('light')}" cx="34%" cy="26%" r="62%">` +
        `<stop offset="0" stop-color="${tint}" stop-opacity="${number(0.08 + 0.22 * intensity)}"/>` +
        `<stop offset="1" stop-color="${tint}" stop-opacity="0"/>` +
        `</radialGradient>` +
        clipMarkup
    )

  switch (texture.type) {
    case 'felt': {
      return {
        defs:
          `<filter id="${id('grain')}" x="0%" y="0%" width="100%" height="100%">` +
          `<feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="2" seed="7"/>` +
          `<feColorMatrix type="matrix" values="0 0 0 0 0.55 0 0 0 0 0.55 0 0 0 0 0.58 0 0 0 0.9 0"/>` +
          `</filter>` +
          depthShade(''),
        underEye:
          `<g ${blend('multiply')}>` +
          clipped(rect(`url(#${id('dark')})`)) +
          `</g>` +
          `<g ${blend('screen')}>` +
          clipped(rect(`url(#${id('light')})`)) +
          `</g>` +
          `<g ${blend('overlay')} opacity="${number(0.16 + 0.3 * intensity)}">` +
          clipped(rect('transparent', `filter="url(#${id('grain')})"`)) +
          `</g>`,
        top: '',
      }
    }
    case 'plush': {
      return {
        defs:
          `<filter id="${id('fur')}" x="0%" y="0%" width="100%" height="100%">` +
          `<feTurbulence type="turbulence" baseFrequency="0.06 0.2" numOctaves="3" seed="11"/>` +
          // Strands take the tint: a white fur film is what frosts the body
          // underneath (soft-light at 0.35..0.8 opacity over every channel).
          `<feColorMatrix type="matrix" values="0 0 0 0 ${channel(tintRgb[0])} 0 0 0 0 ${channel(tintRgb[1])} 0 0 0 0 ${channel(tintRgb[2])} 0 0 0 1.4 0"/>` +
          `</filter>` +
          depthShade(''),
        underEye:
          `<g ${blend('multiply')}>` +
          clipped(rect(`url(#${id('dark')})`)) +
          `</g>` +
          `<g ${blend('screen')}>` +
          clipped(rect(`url(#${id('light')})`)) +
          `</g>` +
          `<g ${blend('soft-light')} opacity="${number(0.35 + 0.45 * intensity)}">` +
          clipped(rect('transparent', `filter="url(#${id('fur')})"`)) +
          `</g>` +
          `<g ${blend('overlay')} opacity="${number(0.1 + 0.2 * intensity)}">` +
          `<filter id="${id('fuzz')}" x="0%" y="0%" width="100%" height="100%">` +
          `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="4"/>` +
          // A mid-grey fuzz is invisible over a lit body: 0.45 sits far enough
          // below white for the overlay to carry measurable high-frequency
          // contrast (the metric is a neighbour difference) without the grey
          // wash a darker value would leave in the shadows.
          `<feColorMatrix type="matrix" values="0 0 0 0 0.45 0 0 0 0 0.45 0 0 0 0 0.47 0 0 0 0.9 0"/>` +
          `</filter>` +
          clipped(rect('transparent', `filter="url(#${id('fuzz')})"`)) +
          `</g>`,
        top: '',
      }
    }
    case 'glossy': {
      return {
        defs:
          `<radialGradient id="${id('sheen')}" cx="50%" cy="50%" r="50%">` +
          `<stop offset="0" stop-color="#ffffff" stop-opacity="${number(0.55 + 0.35 * intensity)}"/>` +
          `<stop offset="0.7" stop-color="#ffffff" stop-opacity="${number(0.08 * intensity)}"/>` +
          `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
          `</radialGradient>` +
          `<linearGradient id="${id('floor')}" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#ffffff" stop-opacity="0"/>` +
          `<stop offset="1" stop-color="#ffffff" stop-opacity="${number(0.1 + 0.14 * intensity)}"/>` +
          `</linearGradient>` +
          depthShade(''),
        underEye:
          `<g ${blend('multiply')}>` +
          clipped(rect(`url(#${id('dark')})`)) +
          `</g>` +
          `<g pointer-events="none">` +
          clipped(
            `<ellipse cx="-52" cy="-76" rx="48" ry="30" fill="url(#${id('sheen')})" transform="rotate(-24 -52 -76)"/>`
          ) +
          `</g>`,
        top:
          `<g ${blend('screen')} pointer-events="none">` +
          clipped(rect(`url(#${id('floor')})`, 'transform="translate(0 26)"')) +
          `</g>`,
      }
    }
    case 'neon': {
      return {
        defs:
          `<filter id="${id('glow')}" x="-40%" y="-40%" width="180%" height="180%">` +
          `<feGaussianBlur in="SourceGraphic" stdDeviation="${number(6 + 6 * intensity)}"/>` +
          `</filter>` +
          `<radialGradient id="${id('light')}" cx="42%" cy="36%" r="70%">` +
          `<stop offset="0" stop-color="#ffffff" stop-opacity="${number(0.16 + 0.2 * intensity)}"/>` +
          `<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>` +
          `</radialGradient>`,
        underEye:
          `<g ${blend('screen')} pointer-events="none">` +
          clipped(rect(`url(#${id('light')})`)) +
          `</g>`,
        top: '',
        glowFilterId: id('glow'),
      }
    }
    default:
      return { defs: '', underEye: '', top: '' }
  }
}
