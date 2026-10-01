import type { AvatarColors } from '../avatar/avatars'
import { createTextureShader, type AvatarTextureConfig } from '../avatar/texture'
import type { RenderedScene } from '../rendering/renderedScene'
import {
  defaultSnapshotComposition,
  normalizeSnapshotComposition,
  snapshotCornerRadius,
  type SnapshotComposition,
} from './snapshotComposition'

export type SnapshotBackground = 'transparent' | 'solid' | 'linear' | 'radial'

export type SnapshotOptions = {
  background: SnapshotBackground
  colorFrom: string
  colorTo: string
  size: number
  texture?: AvatarTextureConfig
  composition?: SnapshotComposition
}

const escapeXml = (value: string) =>
  value.replace(/[&<>"]/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    }
    return entities[character]
  })

const path = (value: string, fill: string, opacity = 1, extra = '') =>
  value
    ? `<path d="${escapeXml(value)}" fill="${fill}" opacity="${opacity}"${extra ? ` ${extra}` : ''}/>`
    : ''

const backgroundMarkup = (options: SnapshotOptions) => {
  if (options.background === 'transparent') return ''
  const fill =
    options.background === 'solid'
      ? options.colorFrom
      : options.background === 'linear'
        ? 'url(#snapshot-linear)'
        : 'url(#snapshot-radial)'
  return `<rect x="-150" y="-150" width="300" height="300" fill="${fill}"/>`
}

const gradientMarkup = (options: SnapshotOptions) => {
  if (options.background === 'linear') {
    return `<linearGradient id="snapshot-linear" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${options.colorFrom}"/><stop offset="1" stop-color="${options.colorTo}"/></linearGradient>`
  }
  if (options.background === 'radial') {
    return `<radialGradient id="snapshot-radial" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="${options.colorFrom}"/><stop offset="1" stop-color="${options.colorTo}"/></radialGradient>`
  }
  return ''
}

export const serializeAvatarSnapshot = (
  name: string,
  scene: RenderedScene,
  colors: AvatarColors,
  options: SnapshotOptions
) => {
  const composition = normalizeSnapshotComposition(
    options.composition ?? defaultSnapshotComposition
  )
  const headPath = scene.headPath.get()
  const backPaths = scene.backPaths.flatMap(item => {
    const value = item.get()
    return value ? [value] : []
  })
  const frontPaths = scene.frontPaths.flatMap(item => {
    const value = item.get()
    return value ? [value] : []
  })
  const offsetX = scene.offsetX.get()
  const offsetY = scene.offsetY.get()
  const texture = options.texture ?? { type: 'none' as const }
  const textureEnabled = texture.type !== 'none'
  const textureShader = textureEnabled
    ? createTextureShader(texture, 'snapshot-body-clip', 'snapshot')
    : null
  const body = [
    ...(textureShader?.glowFilterId
      ? [
          path(
            headPath,
            colors.body,
            1,
            `filter="url(#${textureShader.glowFilterId})" pointer-events="none"`
          ),
        ]
      : []),
    ...backPaths.map(value => path(value, colors.body)),
    path(headPath, colors.body),
    ...(textureShader?.underEye ? [textureShader.underEye] : []),
    `<g clip-path="url(#snapshot-head-clip)">${path(scene.leftPath.get(), colors.eyes, scene.leftOpacity.get())}${path(scene.rightPath.get(), colors.eyes, scene.rightOpacity.get())}</g>`,
    ...frontPaths.map(value => path(value, colors.body)),
    ...(textureShader?.top ? [textureShader.top] : []),
  ].join('')
  const bodyClipMarkup = textureEnabled
    ? `<clipPath id="snapshot-body-clip"><path d="${escapeXml(headPath)}"/>${backPaths
        .map(value => `<path d="${escapeXml(value)}"/>`)
        .join('')}${frontPaths.map(value => `<path d="${escapeXml(value)}"/>`).join('')}</clipPath>`
    : ''
  const isolatedBody = textureEnabled
    ? `<g style="mix-blend-mode:normal;isolation:isolate">${body}</g>`
    : body

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-150 -150 300 300" width="${options.size}" height="${options.size}" role="img" aria-label="${escapeXml(name)}">
  <defs>${gradientMarkup(options)}<clipPath id="snapshot-frame-clip"><rect x="-150" y="-150" width="300" height="300" rx="${snapshotCornerRadius(composition.cornerRadius)}"/></clipPath><clipPath id="snapshot-head-clip"><path d="${escapeXml(headPath)}"/></clipPath>${bodyClipMarkup}${textureShader ? textureShader.defs : ''}</defs>
  <g clip-path="url(#snapshot-frame-clip)">
    ${backgroundMarkup(options)}
    <g transform="translate(${composition.x} ${composition.y}) scale(${composition.scale})"><g transform="translate(${offsetX} ${offsetY})">${isolatedBody}</g></g>
  </g>
</svg>`
}

export const serializePixelSnapshot = (name: string, imageDataUrl: string, size: number) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeXml(name)}">
  <image href="${escapeXml(imageDataUrl)}" width="${size}" height="${size}" image-rendering="pixelated"/>
</svg>`

export const snapshotFileName = (name: string, extension: 'svg' | 'png' = 'svg') => {
  const slug =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'avatar'
  return `${slug}-snapshot.${extension}`
}
