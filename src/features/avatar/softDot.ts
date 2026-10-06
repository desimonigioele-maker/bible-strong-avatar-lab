/**
 * Bridge between the persisted surface document and the dot material model.
 *
 * `avatar-core` owns a flat, serializable knob set because that is what the
 * project JSON has to hold. The renderer needs the richer `BlobConfig`.
 *
 * Both conversions live in the React-free domain layer
 * (`blobConfigFromParams` / `blobParamsFromConfig`), because the standalone
 * runtime needs the forward one and the inspector needs both. A second copy of
 * either mapping here is how a preview and an export drift apart, so there is
 * deliberately only one.
 */

import { blobConfigFromParams, blobParamsFromConfig } from '@/features/rendering/blob'

import type { AvatarPose, SoftDotSurfaceParams } from '@bible-strong/avatar-core'

/**
 * `pose` is the live avatar pose.
 *
 * Passing it is what makes the dot a material mode over the fork's geometry
 * rather than a parallel object: the surface, the perspective and the head
 * rotation all come from the same source the eyes and the silhouette use.
 */
export const softDotParamsToConfig = (params?: SoftDotSurfaceParams, pose?: AvatarPose) => ({
  ...blobConfigFromParams(params),
  ...(pose ? { pose } : {}),
})

export const configToSoftDotParams = blobParamsFromConfig
