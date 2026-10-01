import * as THREE from 'three'

import { type DotSurfaceParams } from './dotEngine'
import { buildDotScene } from './dotEngine'
import { prefersReducedSegments } from './dotEngine'

/**
 * Renders the dot scene offscreen and returns a PNG data URL.
 *
 * The offscreen renderer is created with `preserveDrawingBuffer: true` so the
 * WebGL back buffer survives until `toDataURL` runs — the classic failure
 * mode when serializing WebGL canvases is a blank/transparent image because
 * the buffer was cleared after present.
 */
export const renderDotSnapshotPng = (
  params: DotSurfaceParams,
  size: number,
  poseSeconds = 0
): string => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    alpha: true,
  })
  renderer.setSize(size, size, false)
  renderer.setPixelRatio(1)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const dotScene = buildDotScene(params, prefersReducedSegments() ? 64 : 128)
  try {
    dotScene.update(poseSeconds, 0)
    dotScene.resize(size, size)
    dotScene.render(renderer)
    return canvas.toDataURL('image/png')
  } finally {
    dotScene.dispose()
    renderer.dispose()
  }
}
