/**
 * PNG snapshots through the SVG serializer — the same markup the studio
 * previews and the export ships, rasterized once into a canvas.
 *
 * Deterministic and GPU-free, which is why the retired Three.js snapshot
 * (an offscreen WebGL scene just to freeze one frame) is gone: an impostor
 * that only needs a static picture should not need a scene graph.
 */

import { renderBlobToSvg } from './blobSvg'
import type { BlobConfig } from './blobTypes'

export const renderBlobSnapshotPng = (config: BlobConfig, size: number): Promise<string> => {
  const markup = renderBlobToSvg(config, {
    width: size,
    height: size,
    withExpression: false,
  })
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('2d context unavailable'))
        return
      }
      context.clearRect(0, 0, size, size)
      context.drawImage(image, 0, 0, size, size)
      resolve(canvas.toDataURL('image/png'))
    }
    image.onerror = () => reject(new Error('snapshot rasterization failed'))
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
  })
}
