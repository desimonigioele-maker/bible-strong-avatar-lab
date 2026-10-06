import { useEffect, useRef, useState } from 'react'

import type { AvatarPose, AvatarTextureConfig } from '@bible-strong/avatar-core'

import { BlobRenderer } from '@/features/rendering/blob/blobRenderer'
import { sampleBlobMotion } from '@/features/rendering/blob/blobSvg'
import {
  createBlobWebgl2,
  hasWebgl2,
  packBlobWebgl2Uniforms,
  prefersReducedMotion,
} from '@/features/rendering/blob/blobWebgl2'
import type { BlobConfig, RenderQuality } from '@/features/rendering/blob/blobTypes'

export type DotWebglCanvasProps = {
  /** Renderer-independent material model (config + optional live pose). */
  config: BlobConfig
  quality?: RenderQuality
  pose?: AvatarPose
  idPrefix?: string
  texture?: AvatarTextureConfig
}

/**
 * The dot's renderer adapter, live in the studio.
 *
 * WebGL2 impostor first — one fullscreen quad, one fragment shader, no scene
 * graph. When the browser cannot (no WebGL2, context refused) it renders the
 * SVG engine with the very same config, so the fallback is a renderer choice,
 * never a different material.
 *
 * The component owns no React state per frame: the rAF loop reads the latest
 * props through a ref and writes shader uniforms. Animation updates rendering
 * values; it never triggers a React render.
 */
export function DotWebglCanvas(props: DotWebglCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(props)
  stateRef.current = props
  // One-time capability decision; a failed context flips it exactly once.
  const [fallback, setFallback] = useState(() => !hasWebgl2())

  useEffect(() => {
    if (fallback) return
    const canvas = canvasRef.current
    if (!canvas) return
    const handle = createBlobWebgl2(canvas)
    if (!handle) {
      setFallback(true)
      return
    }
    let raf = 0
    let disposed = false
    const started = performance.now()
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round((canvas.clientWidth || 480) * dpr))
      const height = Math.max(1, Math.round((canvas.clientHeight || 480) * dpr))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }
    const frame = () => {
      if (disposed) return
      resize()
      const current = stateRef.current
      // Renderer-level reduced motion: freeze the clock, keep the composition.
      const seconds = prefersReducedMotion() ? 0 : (performance.now() - started) / 1000
      const motion = sampleBlobMotion(current.config.motion, seconds)
      const uniforms = packBlobWebgl2Uniforms({
        config: current.config,
        quality: current.quality,
        motion,
        tint:
          current.texture && current.texture.type === 'plush'
            ? { color: current.texture.tint ?? '', amount: 0.9 }
            : null,
        size: { width: canvas.width, height: canvas.height },
      })
      handle.render(uniforms, canvas.width, canvas.height)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      handle.dispose()
    }
  }, [fallback])

  if (fallback) {
    // Same config, other renderer: the SVG engine is the fallback AND the
    // export path, so what ships is what the fallback shows.
    return (
      <BlobRenderer
        config={props.config}
        quality={props.quality}
        pose={props.pose}
        idPrefix={props.idPrefix}
        texture={props.texture}
        withExpression={false}
      />
    )
  }
  return <canvas ref={canvasRef} className="dot-webgl2-canvas" aria-hidden="true" />
}
