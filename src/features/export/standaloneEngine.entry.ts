export { expressionFields, poseFromExpression, renderAvatar } from '../avatar/geometry'
export { createTextureShader } from '../avatar/texture'
import { defaultDotSurfaceParams } from '../avatar/surfaces'
import type { SurfaceConfig } from '@bible-strong/avatar-core'
import { blobConfigFromLegacyDot, blobConfigFromParams } from '../rendering/blob'

// The blob engine is React-free, so the barrel stays safe to bundle here: the
// exported runtime rasterizes the exact same markup the studio previews.
export {
  buildBlobScene,
  createDefaultBlobConfig,
  normalizeBlobConfig,
  renderBlobToSvg,
} from '../rendering/blob'

/**
 * Surface-aware model builder for the runtime: the whole surface document
 * goes in, a renderer-independent BlobConfig comes out.
 *
 * The legacy `dot` params map through the same conversion the studio uses, so
 * an old avatar exports as the dot it now renders as. This wrapper also fixes
 * a latent export bug: the runtime used to hand the *whole surface* to
 * `blobConfigFromParams`, whose fields all read `undefined` and fell back to
 * the default soft-blue dot — every exported dot rendered as the default
 * material. One shared wrapper, both callers, one truth.
 *
 * The exported runtime draws dots through the SVG blob engine (vector export
 * fidelity); the studio's live canvas prefers the WebGL2 impostor and falls
 * back to this same engine.
 */
export const softDotConfigFromSurface = (surface: SurfaceConfig | undefined) => {
  if (surface?.type === 'dot') {
    return blobConfigFromLegacyDot(surface.dot ?? defaultDotSurfaceParams)
  }
  return blobConfigFromParams(surface?.softDot ?? surface?.blob2d)
}

export {
  ambientBodyOffset,
  ambientEyeOffset,
  applyAmbientBodyMotion,
  applyAmbientMotion,
  hasAmbientMotion,
} from '../avatar/ambientMotion'
