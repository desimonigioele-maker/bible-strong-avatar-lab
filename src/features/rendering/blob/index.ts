/**
 * Public entry point of the procedural blob engine.
 *
 * Domain modules first, then the serializer. The React renderer lives in
 * `./blobRenderer` and is deliberately *not* re-exported here: keeping the
 * barrel React-free is what allows the standalone engine generator to bundle
 * the whole engine for the export runtime.
 */

export * from './blobTypes'
export * from './blobUtils'
export * from './blobColor'
export * from './blobConfig'
export * from './blobDebug'
export * from './blobGeometry'
export * from './blobLights'
export * from './blobLighting'
export * from './blobColorFields'
export * from './blobMaterial'
export * from './blobPerPixel'
export * from './blobRandomize'
export * from './blobSurface'
export * from './blobSurfaceField'
export * from './blobPresets'
export * from './blobSvg'
