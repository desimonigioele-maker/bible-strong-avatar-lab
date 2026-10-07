# 0024: Procedural 2.5D blob material renderer

## Status

Accepted

## Context

Avatar Lab could render bodies two ways: SVG surfaces driven by 3D-inspired geometry, and the WebGL
`dot` surface added for soft, volumetric blobs. The WebGL route looked good but could not be used
everywhere. It needs a live GPU context, it is invisible in a static SVG export, and it cannot run in
the generated standalone engine on a machine without WebGL. The SVG route exported and scaled
perfectly but had no way to express volume: a flat fill plus a gradient reads as a flat shape, no
matter how well the silhouette is drawn.

Neither extreme was acceptable. Editorial work needs the volume of the GPU blob; the export, the
embedded runtime, the print stylesheet and low-end devices need the SVG blob.

## Decision

We add a third surface, `softDot`, rendered by a procedural 2.5D engine in
`src/features/rendering/blob`. The dot is a **material mode over the studio's existing geometry**,
not a second geometry system: `avatar-core` now exports `projectSurfaceSample`, which returns the
projected point and the camera-space normal of any `SurfaceConfig`. The engine lights that surface
instead of inventing a sphere, so an elongated or asymmetric silhouette is lit as the object it
actually is, and perspective, head rotation and depth are inherited rather than re-derived.

Volume is _modelled_ rather than rasterized. A real light rig (KEY, FILL, RIM, AMBIENT) is placed at
a studio distance in camera space, a per-point normal is read from the surface and perturbed by
low-frequency seeded noise, and the full formula is evaluated on a grid before being collapsed into
gradient stops. Overlapping OKLab colour fields, a surface-integrated rim, a curvature-weighted
cavity and `feTurbulence` surface bands complete the material.

The renderer stays SVG-first and keeps WebGL as an opt-in "ultra" path, not as a prerequisite. The
model is deliberately split from the renderer: `createBlobMaterial` returns a description, not
markup, and `BlobConfig` is renderer-agnostic, so a GPU adapter can be added later without
reworking the data model or the editor.

Shape, lighting, material and motion are independent sub-configs, so one silhouette can be paired
with any material and the geometry is never regenerated when only the material changes.

`blobConfigFromParams` is the single persisted-parameters to `BlobConfig` conversion, shared by the
studio bridge and the standalone runtime.

Two renderers implement that same material. The default `field` renderer paints a stack of clipped
gradient layers; `perPixel` paints an SVG filter chain (`feDiffuseLighting` per light, specular,
ambient flood, tint) whose height map is written to the **alpha** channel, because `feDiffuseLighting`
reads `SourceAlpha` as a bump map and a grey RGB ramp lights as a flat surface. The filter chain is
clipped to the procedural silhouette over a flat base-colour underlay. Per-pixel is opt-in for
`ultra` and is never the default.

The engine ships with the instruments that keep it honest: a debug overlay that is byte-identical to
production markup until its flags are passed, a randomizer with explicit per-group locks, a DOT
MATERIAL LAB that renders the shape × material × lighting matrix beside a deliberately flat
reference, and a cost budget that pins node, filter and build-time counts per quality.

The lab is scored by an **oracle** derived from the reference artwork: mean saturation ≥ 0.65
(chromatic cells only), p95−p05 luminance range ≥ 100, mean local texture ≥ 3.5, with the flat
reference as the control — it must pass range and fail texture, or the metric is not measuring
material. Tuning to that oracle, rather than to screenshots, drove the current shading model: the
body ramp normalizes against the strongest diffuse the sampled surface actually receives and mixes
in OKLab (a fixed denominator saturated `lit` across the bright half; sRGB mixes walked through the
grey interior of the colour cube), the cavity mix is weighted by `(1 − lit·0.65)` so the ramp's
top stop can reach the palette highlight, the per-pixel chain composites its specular and a
quarter-strength key lift _after_ the base tint (before it, the multiply capped every pixel at the
base colour's luminance — the whole tonal-range gap), and a `feTurbulence` height bump is composited
into the per-pixel height field so its texture is lit rather than painted. The four
`feTurbulence` surface bands were disabled at every quality by measurement: they cost 0.13
saturation and 15 points of range while adding 0.04 texture. Default quality is `ultra`. Final
oracle run over the full sixteen-material matrix: field 0.710 / 101.9 / 3.54, per-pixel
0.713 / 100.1 / 5.31 — all renderer verdicts green.

**The live dot renders through a WebGL2 impostor, and Three.js is gone.** The studio's dot canvas
is an adapter (`DotWebglCanvas`): one fullscreen triangle and one fragment shader when WebGL2 is
available, the SVG engine with the same renderer-independent `BlobConfig` otherwise. The impostor
rebuilds the surface per pixel — silhouette LUT from the fork's own geometry outline, pseudo-sphere
normal, seeded deformation, the very `createLightRig` rig the SVG path builds, the `evaluateColor`
ramp reproduced in GLSL through an `oklabMix`, cavity weighted against the light, three scales of
lit noise — so coherence is structural: both renderers read the same palette, the same lights, the
same field and the same silhouette source. Scored against the same oracle in the lab's own webgl2
column (one shared GL context painted at the oracle's raster size and blitted into per-cell
canvases): sat 0.767 / rng 130.5 / tex 5.49, all green at `ultra`. The SVG engine keeps its role as the
fallback, the vector exporter and the lab's measurement truth; the runtime exports dots through it
exclusively, which also fixed a latent bug where the runtime handed the whole surface document to
`blobConfigFromParams` and every exported dot silently rendered with the default material. The
legacy `surface.type === 'dot'` params map onto the same model (`blobConfigFromLegacyDot`), their
eye offsets fold into the fork's eye layer, and snapshots rasterize the SVG serializer. Three.js,
`@react-three/fiber` and drei left `package.json`; the app bundle lost ~870 kB. WebGPU stays a
future adapter behind the same seam — the pack is a plain uniform record.

## Consequences

Blobs are authored, edited, exported and embedded through the same code path, with no GPU
requirement and no runtime dependency. `renderBlobToSvg` is the single serializer, so a preview and
its exported asset cannot drift apart, and every id is namespaced so many blobs can share a page.

The volume is an approximation: there is no self-occlusion, no cast shadow and no refraction. Shapes
that depend on real 3D falloff still belong to the WebGL `dot` surface. The engine's complexity is
concentrated in the shading model, which must be re-tuned by hand rather than fixed by adding
geometry — the oracle says _whether_ a change paid, never _why_, so every constant in the ramp
carries a comment naming the measurement behind it — and the `renderQuality` ladder exists because
the full layer stack is wasteful below roughly 64 px. The oracle's texture floor (3.5) is a floor,
not a target: the reference artwork measures 4.5–5.6, so a render that merely clears the threshold
can still look smoother than the target.

The body ramp is linear along the light axis rather than radial. A radial gradient centred on the
highlight cannot represent a sphere lit from one side, because the same radius is bright on the lit
side and dark on the other; the radial structure a disc does have is carried by the colour fields and
the core shadow instead. This is a deliberate trade: the shading is less "round" in the naive sense
and considerably more like a lit body.

The exported runtime is a string, so nothing in it is typechecked and a branch of its render loop can
diverge from the one beside it without any compiler noticing. The blob branch did exactly that: it
armed its own animation frame on top of the one the shared tick arms, so `pause` and `destroy` only
held one handle and an orphan chain kept rendering a paused avatar forever, and it dropped the
ambient eye offset so an exported dot held a stare. `procedural-runtime-test.ts` now mounts the real
runtime source in jsdom against a manual clock, which is the only way a string of code gets tested.

Expanding the lab from eight to sixteen materials turned the oracle into a real regression tool: the
pastel palette variants measured 0.49-0.63 saturation against a 0.65 floor — visibly washed next to
the reference family — and the fix was palette-level (OKLCH base deepening on the original hue, plus
explicit deep `shadowColor` where the darker base compressed the ramp's luminance span, since OKLab
L→Y is cubic). Two structural findings came out of the same round. The per-pixel path's flat ambient
flood (held at 0.55× the rig's ambient after measurement) floors the shadows, and deep palettes paid
2-25 range points against the gradient path for exactly that reason — the gradient path had already
had its equivalent trim. And reduced motion is enforced in the renderers, not in CSS: a media query
cannot reach a `useFrame` or `rAF` loop, so the WebGL gate lives in `DotWebglCanvas`'s rAF loop and
`dotScene.update()` beside the SVG renderer's existing check. Motion was audited in the same pass: surface drift shared
float's oscillator, making the `surfaceDriftSpeed` knob dead and the two movements one joint motion;
all four motion axes now run on independent oscillators. The OKLab mixing utility gained direct tests
(including a measured correction to its own docstring: same-hue blues mix nearly identically in sRGB,
the chroma detour is a cross-hue phenomenon) and `clamp01` now rejects non-finite inputs, so a NaN
amount can never reach generated markup.
