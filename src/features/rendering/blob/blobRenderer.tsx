/**
 * React renderer for the blob engine (FASI 12, 13, 16, 18).
 *
 * The component is deliberately thin: every pixel comes from `buildBlobScene`,
 * the same serializer the SVG export uses, so the preview can never drift from
 * the exported asset. React re-renders only when the durable config changes;
 * breathing, float and rotation are driven by Motion values updated from a
 * single rAF loop, never from React state (FASI 16).
 */

import { motion, useMotionValue } from 'motion/react'
import { useEffect } from 'react'

import type { AvatarPose, AvatarTextureConfig } from '@bible-strong/avatar-core'

import type { BlobDebugFlag } from './blobDebug'
import type { SurfaceField } from './blobSurfaceField'

import { normalizeBlobConfig } from './blobConfig'
import { buildBlobScene, sampleBlobMotion } from './blobSvg'
import type { BlobConfig, RenderQuality } from './blobTypes'

const FRAME = 320

export type BlobRendererProps = {
  config: BlobConfig
  /** Overrides the config quality; used to keep small previews cheap. */
  quality?: RenderQuality
  className?: string
  width?: number | string
  height?: number | string
  withExpression?: boolean
  /** Provide a label for a meaningful blob; omit for a decorative one. */
  label?: string
  /** Namespaces the ids; must be unique per mounted blob on a page. */
  idPrefix?: string
  groundShadow?: boolean
  /** Studio texture finish applied over the modelled volume. */
  texture?: AvatarTextureConfig
  /** Camera pose the material is attached to; see `BlobSvgOptions.pose`. */
  pose?: AvatarPose
  /** Diagnostic overlays; empty in production. */
  debug?: BlobDebugFlag[]
  /** Precomputed surface field; see `BlobSvgOptions.field`. */
  field?: SurfaceField
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function BlobRenderer({
  config,
  quality,
  className,
  width = '100%',
  height = '100%',
  withExpression = true,
  label,
  idPrefix = 'blob',
  groundShadow = true,
  texture,
  pose,
  debug,
  field,
}: BlobRendererProps) {
  const normalized = normalizeBlobConfig(config)
  // Reduced motion is resolved once per render: the static pose is already the
  // designed look, so nothing has to be "recovered" (FASE 25).
  const motionConfig = prefersReducedMotion()
    ? { ...normalized.motion, enabled: false }
    : normalized.motion

  const scene = buildBlobScene(normalized, {
    quality,
    idPrefix,
    withExpression,
    texture,
    pose,
    debug,
    field,
  })

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useMotionValue(0)
  const scaleX = useMotionValue(1)
  const scaleY = useMotionValue(1)

  useEffect(() => {
    if (!motionConfig.enabled) {
      x.set(0)
      y.set(0)
      rotate.set(0)
      scaleX.set(1)
      scaleY.set(1)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const sample = sampleBlobMotion(motionConfig, (now - start) / 1000)
      x.set(sample.translateX)
      y.set(sample.translateY)
      rotate.set(sample.rotation)
      scaleX.set(sample.scaleX)
      scaleY.set(sample.scaleY)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [motionConfig, rotate, scaleX, scaleY, x, y])

  const face = withExpression ? scene.face : ''

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox={`${-FRAME / 2} ${-FRAME / 2} ${FRAME} ${FRAME}`}
      width={width}
      height={height}
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { 'aria-hidden': true, focusable: false })}
    >
      <defs dangerouslySetInnerHTML={{ __html: scene.defs }} />
      {groundShadow ? <g dangerouslySetInnerHTML={{ __html: scene.shadow }} /> : null}
      {scene.glow ? <g dangerouslySetInnerHTML={{ __html: scene.glow }} /> : null}
      <motion.g style={{ x, y, rotate, scaleX, scaleY }}>
        <g dangerouslySetInnerHTML={{ __html: scene.body + face + scene.debug }} />
      </motion.g>
    </svg>
  )
}
