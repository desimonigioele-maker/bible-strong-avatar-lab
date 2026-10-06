# Procedural 2.5D blob rendering

How the `softDot` surface is built, and why it is 2.5D rather than 3D. The architectural decision
lives in [ADR-0024](adr/0024-procedural-2-5d-blob-material-renderer.md).

## Why 2.5D and not full 3D

The blobs in this project are read as soft objects from a distance and inspected up close for
surface detail. That target is reachable with a modelled normal and a handful of layered gradients.
Full 3D would add a GPU dependency to the export path, break static SVG output, and force the
standalone engine to ship a renderer it can no longer run everywhere. So the engine models volume
instead of computing it, and keeps the option of a GPU adapter open (see _Future GPU path_).

## Architecture

The dot is a **material mode over the studio's existing geometry**, not a second geometry system.
`projectSurfaceSample` (exported from `avatar-core`) returns the projected point and the
camera-space normal of any `SurfaceConfig`, so the material lights the same surface the eyes are
placed on.

```
BlobConfig  (serializable, renderer-agnostic, + optional live AvatarPose)
     |
     +-- blobGeometry.ts       shape  -> points -> closed Catmull-Rom path (silhouette)
     +-- blobSurfaceField.ts   SurfaceConfig + pose -> limb, normals, edge distance, curvature
     +-- blobLights.ts         KEY / FILL / RIM / AMBIENT rig + the surface formula
     +-- blobColorFields.ts    material + light axis -> overlapping OKLab colour spots
     +-- blobMaterial.ts       material config -> BlobMaterialDefinition (palette + response)
     +-- blobLighting.ts       samples the formula on a grid -> layer definitions
     +-- blobSurface.ts        quality + material -> noise bands and the active layer plan
     +-- blobTexture           studio texture (felt/plush/glossy/neon) via createTextureShader
     |
     +-- blobSvg.ts            all of the above -> deterministic SVG markup
             |
             +-- blobRenderer.tsx   thin React component for the studio
             +-- renderBlobToSvg    used directly by the exporter and the runtime
```

Domain modules never import React. `index.ts` re-exports the engine but deliberately omits
`blobRenderer.tsx`, which is what lets the standalone engine generator bundle the whole engine
through `standaloneEngine.entry.ts`.

`blobConfigFromParams` is the single conversion from persisted parameters to a `BlobConfig`. Both
the studio bridge (`features/avatar/softDot.ts`) and the standalone runtime call it, because a second
copy of that mapping is exactly how a preview and an export drift apart.

## Data model

| Group        | Owns                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| `shape`      | silhouette: seed, point count, radius, irregularity, lobes, smoothness |
| `lighting`   | light direction, intensity, ambient, shadow, rim, cavity, specular     |
| `material`   | type, base color, roughness, sheen, specular, grain, macro/micro noise |
| `motion`     | breathing, float, rotation, surface drift                              |
| `expression` | optional face; off when the studio's own SVG eyes carry expressions    |
| `quality`    | `low` / `medium` / `high` / `ultra`                                    |

Shape, lighting, material and motion are independent on purpose: a material change must never
regenerate the silhouette, and an expression must never touch the material.

`normalizeBlobConfig` runs every public entry point, so the renderer only ever sees finite numbers,
known enum members and in-range values. `validateBlobConfig` states those invariants and is used by
the tests.

## Seeded noise

Nothing in the engine calls `Math.random` or `Date.now`; a test enforces this by scanning the
module sources.

- `mulberry32` — the seeded stream, used for lobe and asymmetry phases.
- `hashLattice` + `valueNoise2D` — quintic-faded bilinear value noise on an integer lattice.
- `fbm2D` — octaves of value noise, normalized back to 0..1.

Shape noise and surface noise are kept apart. The outline only uses a low-frequency mass term, a
lobe harmonic and a barely-visible micro deformation; everything finer belongs to the material, so
the silhouette never reads as jittery.

## Shape generation

`buildBlobGeometry` samples `pointCount` angles and, for each one, sums three separated frequency
bands: the organic mass, the lobe harmonic, and the outline micro deformation. The result is
normalized on its mean radius so elongation grows the shape instead of silently shrinking it.

The outline is emitted as a closed Catmull-Rom spline converted to cubic Béziers. `smoothness` is
the tension of that spline: at 0 every segment degenerates to a straight chord, at 1 it is a fully
round curve. This is what keeps the shape free of cusps and micro-spikes.

Fourteen shape families (`blobShapePresets`) set the base tuning for round, elongated, bean, amoeba,
pill, cloud, triangle and so on. Picking a family swaps the preset in and keeps the current seed.

## Lighting model

The surface the material lights is the studio's own `SurfaceConfig`, sampled through
`projectSurfaceSample`. The **limb** — the set of points whose camera normal is perpendicular to the
view — is found with the same test the fork already uses to trace its organic outline
(`|cameraNormal.z| <= 0.2`), so the dot's silhouette and the avatar's silhouette are the same curve by
construction. Every interior sample walks its own meridian from the limb to the pole.

At each sampled point the engine evaluates the whole formula:

```
N = deformNormal(normalAtScreenPoint(p), p, seed, deformation)

D = Σ pow(max(0, N·L_i), e_i) · intensity_i · attenuation      (KEY + FILL + RIM)
S = pow(max(0, N·H), exponent) · specular                       (H = normalize(L + V))
F = pow(1 - N·V, sheenPower) · sheen
R = pow(1 - N·V, rimPower) · rim
C = cavity(edgeDistance, curvature, cavityStrength, aoStrength)

lit  = clamp01((D - ambient) / peak)          // peak = strongest diffuse the surface receives
color = mixOklab(shadow, base, lit)                        // lit body, OKLab ramp
      → mixOklab(…, highlight, lit³(3 − 2·lit)·(1 − roughness·0.35))  // squared window, top third
      → mixOklab(…, cavity, C · 0.55 · (1 - lit·0.65))     // occlusion weighted against the light
      → OKLab drift by macro noise
      → OKLab break by micro noise
```

Five details matter more than the formula itself.

**The ramp is normalized against its own peak.** `lit` divides by the strongest diffuse the sampled
surface actually receives rather than by a fixed constant. A fixed reference saturates `lit` at 1
across the bright half of the ramp — the facing pole sits at barely half the real maximum, because
the key light is off to the side — and a saturated ramp is shaped by the cavity and the noise
instead of by the light, which measured flatter than a plain radial gradient. The mixes run through
OKLab: interpolating saturated blues in sRGB walks through the interior of the colour cube, and the
interior of that cube is grey, so the ramp shed a fifth of the body's saturation on its way from
shadow to highlight.

**Lights sit at a studio distance.** A light placed on the unit sphere leaves every point facing away
from it receiving exactly zero, so the shadow side goes black. The rig is pushed out to 3.2 radii,
which is what lets one key wrap far enough around the body to model a soft object.

**The body ramp is linear along the light axis, not radial.** A sphere lit from one side is dark on
the shadowed limb, mid at the pole and bright on the lit limb, and that variation runs along the
axis. A radial gradient centred on the highlight cannot express it: the same radius is bright on the
lit side and dark on the other, so a single radial ramp either collapses to a flat tint or doubles
back on itself. The radial structure a disc genuinely has is supplied separately, by the colour
fields and the core shadow.

**The highlight is its own layer.** The specular peak sits where the half vector points — off the
axis, between the pole and the lit limb — and moves when the key light moves. A highlight baked into
the body ramp could not do that, and a highlight on the axis reads as a decal.

**The cavity is weighted against the light.** The occlusion mix is multiplied by `(1 - lit·0.65)`,
so a crevice turned toward the key is not in shadow. This is also what lets the ramp reach its top:
the brightest ramp stop lands close to the limb where the edge term runs at half strength, and a
flat cavity mix pulled that peak back below the base colour (L132 against a palette highlight of
L203). That missing cap _was_ the tonal range the reference artwork had and the render did not.

Rim, cavity and edge shading are blurred strokes along the silhouette and a scaled inset of it. The
inset follows the outline, so concave regions darken more than convex ones. The rim is masked by a
linear gradient so it only appears opposite the key light, and it is integrated into the surface
rather than glowing outside it.

### When the silhouette cannot be traced

A surface with no usable spread still hands the limb test thousands of points, because in this
parameterization the silhouette is a **band**, not a curve: every longitude at the facing pole has a
near-zero normal z. Counting points therefore says nothing about whether the silhouette is real —
only how far it actually spreads does, so the field falls back when either traced extent is under a
thousandth of the nominal size.

The fallback is the Phase 6 soft spherical surface in silhouette space: `r2 = x² + y²`, inside the
shape `z = sqrt(max(0, 1 - r2))` and `N = normalize(x, y, z)`. On the limb `r2 = 1`, so `z = 0` and
the normal is the silhouette's own tangent — the same normals a traced limb would have produced. The
ring is stretched by the silhouette's own aspect, so a wide flat body stays wide and flat instead of
becoming a circle.

A malformed surface is contained rather than propagated. The export runtime hands its payload
straight to the field without a parse step, so a single `NaN` in an exported JSON would otherwise
reach the `d` attribute and the avatar would silently vanish.

## Colour fields

A single `blue → darkBlue` ramp is the flattest possible reading of a dot. `buildColorFields` emits up
to five overlapping spots — a cool lift where the key lands, a violet body, a warm white highlight, a
deeper blue in the shadow — each a camera-anchored radial layer clipped to the silhouette, with its
colour resolved in OKLCH as an offset from the material's own base. The palette follows the material
and the spots are placed along the light axis, so a yellow dot gets a warm field and a blue dot a
cool one from the same recipe. They sit above the body and below the shadow passes, so they tint the
material rather than painting over it.

## Material

Palettes are derived in OKLCH from a single base color: highlights move up in lightness and down in
chroma, shadows move down and cool slightly. When a target leaves the sRGB gamut the chroma is
reduced by bisection instead of clipped, which avoids the flat banding plain clamping produces. Each
base color also gets a small, stable hue bias from an FNV-1a hash of its own text, so two blobs
sharing a base do not look like the same material printed twice.

`createBlobMaterial` returns a description, not markup. Per-type profiles (`materialProfiles`) act as
multipliers on the user-facing sliders, so a preset chooses a _character_ and the sliders stay
meaningful inside it. Matte has zero specular, plush trades specular for sheen and fiber, glass
raises both specular power and rim.

Sixteen presets ship in `blobPresets.ts` as pure data: five soft, four plush, plus clay, gel, matte,
glass, aurora, milk and smooth. Each one changes the whole character of the surface — roughness,
sheen, fiber, specular, noise, colour spots — not only the hue.

Micro colour variation is deliberately capped at **0.05** in `normalizeBlobConfig`. Above that the
surface stops reading as a material and starts reading as a stain.

## Surface detail

The surface plan defines four `feTurbulence` bands — macro (very low frequency tonal undulation),
micro (fine variation), grain and fiber (anisotropic, for plush) — and **all four are disabled at
every quality**: measured on the acceptance gallery, the band stack cost 0.13 saturation and 15
points of tonal range while adding 0.04 texture, because flat grey paint blended over a composited
body pulls every channel toward grey. The emitters stay in the code with a 0.5 (identity) tone, so a
future material can opt a band back in with a blend that has been measured to pay for itself. The
texture the material needs comes from the ramp's dither, the studio finish, and — on the per-pixel
path — the lit height bump below. The turbulence seed is still forwarded from the blob seed, so any
enabled band is identical in the preview, the export and any later rasterization.

## Studio textures

The repository already ships a texture system (`felt`, `plush`, `glossy`, `neon`) that layers
`feTurbulence` and blend passes over the body. The blob engine consumes that system rather than
reimplementing it: `renderBlobToSvg(config, { texture })` builds the shader with
`createTextureShader(texture, `${prefix}-clip`, …)`, so the texture clips to the procedural outline
instead of to the avatar's head path.

The texture is an **additional layer over the modelled volume, never a replacement for it**. The
gradient ramp still carries the form; the texture only adds the finish on top. Each texture's
markup lands in the right slot:

| Slot                  | Content                                  |
| --------------------- | ---------------------------------------- |
| `glow`                | blurred body copy behind the blob (neon) |
| `textureUnderSurface` | finish between surface noise and rim     |
| `textureTop`          | finish above everything, under the eyes  |

Because the texture clips to the blob outline, the Studio can expose it as a second shortcut inside
the blob panel while the canonical control stays in the existing Texture panel. Both write the same
avatar-level field, so there is still one source of truth.

Measured at 200 px, each texture shifts the render in the direction its name promises: `plush`
lifts the mean tone, `glossy` compresses the dynamic range (a sheen flattens the mid-tones), `neon`
adds pixels outside the silhouette through the glow layer.

## Quality ladder

| Quality  | Layers | Content                                                                   |
| -------- | ------ | ------------------------------------------------------------------------- |
| `low`    | 3      | silhouette, volume ramp, rim                                              |
| `medium` | 9      | adds light wash, fill bounce, core shadow, edge shading, cavity, specular |
| `high`   | 10     | adds sheen; 12 probe samples instead of 8                                 |
| `ultra`  | 10     | same layers, 18 probe samples, 48 per-pixel height samples instead of 28  |

The default quality is `ultra`. The ladder now buys sampling density, not more filters: the four
`feTurbulence` bands are off at every quality (measured — see _Surface detail_), and `low` skips the
wash and cavity passes because below roughly 64 px they are invisible anyway.

## Renderer choice

`renderer` is part of the blob parameters and picks between two implementations of the same
material. Both read the same config, the same pose and the same surface field; they differ in how
the pixels are produced.

| Renderer   | How it paints                                                                     | Character                                           |
| ---------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| `field`    | a stack of clipped gradient layers, one per shading band                          | soft, continuous, cheap, resolution independent     |
| `perPixel` | an SVG filter chain: `feDiffuseLighting` per light, specular, ambient flood, tint | crisper micro-detail, resolution dependent, heavier |

The per-pixel chain writes its height map into the **alpha** channel, not into luminance.
`feDiffuseLighting` reads `SourceAlpha` as a bump map, so a grey ramp in RGB is a flat surface to
the filter and the lighting comes out uniform. The chain is also clipped to the procedural
silhouette with a `clipPath`, and a flat base-colour path sits underneath it, so the lit result is a
dot and not the filter's bounding rectangle.

A high-frequency `feTurbulence` is composited into that height field (`k2 = 0.07` over the ellipsoid)
before the lighting primitives read it, so `N·L` varies pixel by pixel and the texture is _lit_
rather than painted — a painted band costs saturation (measured), a height bump costs none. The
specular and a quarter-strength key lift are composited **after** the base tint: screened before it,
the multiply capped every pixel of the body at the base colour's luminance, which was the whole
tonal-range gap against the field renderer. The flat ambient flood is held below the rig's nominal
ambient (0.55×): a flat floor lifts the shadows everywhere, and deep saturated palettes pay for it in
tonal range — measured, the per-pixel path lost 2-25 range points against the field path on exactly
those materials before the trim. On the oracle the two renderers land within noise of each other:
field 0.710 / 101.9 / 3.54 and per-pixel 0.713 / 100.1 / 5.31 (saturation / range / texture) over the
full sixteen-material matrix.

Per-pixel is the opt-in path for `ultra`, and it is never the default: it costs about 1.5× the
markup of the field renderer and its detail evaporates below the size it is meant for.

## Live renderer: WebGL2 impostor

The studio's live dot renders through an adapter (`DotWebglCanvas`): a **WebGL2 impostor** when
`canvas.getContext('webgl2')` succeeds, the SVG engine with the very same config otherwise. The
adapter owns the fallback, so a renderer choice is never a different material. Exports always go
through the SVG engine — vector fidelity is the contract — and the lab measures the SVG paths; the
impostor was scored against the same oracle in a browser harness over the full sixteen-material
matrix at `ultra`: **sat 0.774 / rng 131.8 / tex 3.94**, all verdicts green, 128/128 cells rendered.

The impostor (`blobWebgl2.ts`) is one fullscreen triangle and one fragment shader. There is no
scene graph and no Three.js — the dependency is removed from `package.json`, and the app bundle
shed ~870 kB with it. Per pixel the shader rebuilds the surface the SVG engine derives in
TypeScript:

```
implicit surface (silhouette LUT + pseudo-sphere z)
  → normal field (+ seeded noise deformation)
  → camera-space multi-light      (the very LightRig the SVG path builds)
  → soft diffuse / broad specular / sheen / rim
  → cavity + AO weighted against the light
  → OKLab ramp (shadow → base → highlight window, light-weighted cavity)
  → macro / nap / micro noise, colour spots
  → soft tone map
```

Coherence between the renderers is by construction, not by eye: `packBlobWebgl2Uniforms` calls
the same domain functions — `createBlobMaterial` for the palette, `buildBlobLighting` →
`createLightRig` for key/fill/rim positions, colours, falloffs and ambient, `buildDotSurfaceField`
for the pose projection, `buildBlobGeometry` binned into a 32-entry radial silhouette LUT — and
the shader mirrors `blobLights.ts` term by term (same `1/(1+d²·0.12)` attenuation, Blinn specular
on the rig's own half vector, Fresnel sheen/rim, the `cavityTerm` formula) while `oklabMix`
reproduces `evaluateColor`'s ramp in GLSL. The shader's y axis is negated to live in the SVG's
y-down frame; the first build lit the lower-left dot under a key-upper-left rig, which is exactly
the class of disagreement this shared-frame rule prevents.

Determinism: every noise term is a pure function of the seed, motion enters as uniforms from
`sampleBlobMotion`, and reduced motion freezes the clock inside the rAF loop — a CSS media query
cannot reach a rAF loop. Surface detail is luminance modulation of the ramp (lit texture, never
paint): macro fbm, nap/fiber at ~150–260 cycles per body-unit, micro hash — three scales, amplitudes
tuned against the oracle's texture floor, because a surface below that band reads as a smooth ball
however good its lighting is (measured: 1.74 → 3.94 across four tuning steps).

The legacy `surface.type === 'dot'` params map through `blobConfigFromLegacyDot` onto the same
model, their eye offsets fold into the fork's SVG eye layer, and snapshots rasterize the SVG
serializer (`renderBlobSnapshotPng`) instead of the retired offscreen Three.js scene.

## Debug overlay

`buildBlobDebugOverlay` returns inert markup for eight flags: `silhouette`, `center`, `normals`,
`lights`, `cavity`, `noise`, `bounds`, `seed`. With no flags it returns `''`, so a diagnostic build
and a shipping build produce byte-identical markup unless the flags are passed.

A light behind the camera gets a dashed marker rather than a solid one, because a light that
contributes nothing and a light that contributes a lot look identical in a screenshot otherwise.

The overlay is a debugging instrument, not a control: `blob-perf-test.ts` fails if the overlay ever
grows past twice the size of the scene it annotates.

## Randomize with locks

`randomizeBlobConfig(config, groups, seed)` re-rolls only the groups it is given, across four
groups — `shape`, `material`, `light`, `motion`. The key light is constrained to the upper half of
the sphere, and motion amplitudes stay subliminal, because a random dot that spends half its states
spinning is not a variant of anything.

The seed always advances, even when every group is locked. A "variant" that returns the identical
image teaches an author that the button is broken.

`SoftDotFields` exposes the locks as four checkboxes above the buttons, and the panel states what
each button will and will not touch before it is pressed.

## DOT MATERIAL LAB

`src/features/rendering/dotLabGrid.ts` holds the matrix — four shape families by **sixteen**
materials (the full soft/plush colour ramp, the neutral materials, the two field-count stress
presets, and pearl) by two lighting setups — and `DotMaterialLab.tsx` renders it at `#dot-lab`. Every
cell can show the **flat reference**: a single radial gradient over the material palette,
deliberately the cheapest possible dot. It is not a renderer and is never shipped; it exists so the
grid shows what the material adds rather than what a coloured circle looks like. The debug overlay
can be toggled per flag from the lab header, so a shading term can be isolated without rebuilding
the gallery.

`src/features/rendering/__tests__/dot-lab-fixture-test.ts` writes the same matrix to a static
gallery (`DOT_LAB_DIR=<dir> npx vitest run …`), which is how the renderers were measured. Rasterizing
each serialized SVG and reading its luminance percentiles is what caught the four real bugs in this
engine: an inverted horizon latitude, lights placed on the unit sphere, a saturated diffuse ramp,
and an unclipped filter box.

The gallery is scored against an **oracle** (`dotLabMetrics.ts`) whose thresholds are derived from
the reference artwork: mean saturation ≥ 0.65 (chromatic cells only), p95−p05 luminance range ≥ 100,
and mean local texture ≥ 3.5. Each slot prints ✓/✕ per metric, and the flat reference is the
control — it must pass range and fail texture, otherwise the metric is not measuring material. As of
the acceptance run (sixteen materials, 128 cells per slot): flat 0.755 / 120.5 / 1.31, field
0.710 / 101.9 / 3.54, per-pixel 0.713 / 100.1 / 5.31 — all six renderer verdicts green. The lab
cells render at `ultra` with the plush finish tinted to the material's own highlight
(`labTextureFor`), so the texture the oracle measures is the texture a shipped dot actually has.

The sixteen-material set forced one palette-level correction: the pastel variants (soft pink and
purple, the whole plush ramp, aurora) measured 0.49-0.63 saturation and 74-95 range — visibly washed
and flat against the reference family. Their bases were deepened in OKLCH along the original hue,
and the materials whose tonal span then compressed (OKLab L→Y is cubic, so a darker base produces a
smaller luminance spread) carry an explicit deep `shadowColor`. Dark chromatic shadows score 1.0 on
the saturation metric and pull p05 down, so the two axes move together instead of trading off.

## Cost budget

`blob-perf-test.ts` pins what the dot costs today, because both renderers grow silently.

| Quality  | Field: tags / filters / bytes | Per-pixel: tags / primitives / bytes |
| -------- | ----------------------------- | ------------------------------------ |
| `low`    | 80 / 2 / 19.9 kB              | 125 / 25 / 28.3 kB                   |
| `medium` | 104 / 2 / 30.7 kB             | 143 / 25 / 38.8 kB                   |
| `high`   | 111 / 2 / 31.2 kB             | 150 / 25 / 39.2 kB                   |
| `ultra`  | 117 / 2 / 31.5 kB             | 176 / 25 / 40.8 kB                   |

Build time is ~2.5–3 ms for a full scene at `ultra`. The exported runtime resamples the surface
whenever the pose signature changes, so a 30 fps ambient drift pays that cost every frame; it is
budgeted under one frame deliberately, because a breathing motion that stutters is worse than one
that is slightly coarser.

## Export

`renderBlobToSvg` is the single serializer. The studio preview, the SVG export and the standalone
runtime all call it, which is what keeps preview and export identical.

- every gradient, mask, clip and filter id is namespaced by `options.idPrefix`;
- all `url(#…)` references resolve to ids the same document defines (enforced by a test);
- blend modes are inline styles, so nothing depends on the app stylesheet;
- the only absolute URL in the output is the SVG namespace;
- decorative blobs are `aria-hidden`, meaningful ones take an `aria-label`;
- `withExpression: false` renders a body-only graphic for editorial use.

The exported runtime drives the blob branch of its render loop through the shared `tick`, exactly
like every other surface. Two defects lived in that branch and both are now covered by
`procedural-runtime-test.ts`, which mounts the real runtime source in jsdom against a manual clock:

- the branch armed its own animation frame from `render` on top of the one `tick` arms, forking the
  loop. `pause` and `destroy` only hold one handle, so an orphan chain kept rendering a paused
  avatar forever, and an expression transition never reached the tick that interpolates it;
- the branch dropped the ambient eye offset, so an exported dot held a stare while the studio
  version looked around.

`pause` now cancels the pending frame and the tick loop no longer re-arms while paused, so ambient
motion is a reason to keep ticking and never a reason to keep ticking a paused avatar.

The material's `defs` are **replaced**, never appended. Every ambient frame rebuilds the scene under
the same id prefix, so appending left another copy of every gradient and filter behind on each one:
the document grew without bound — 34 duplicate copies of a single id after three seconds — and
because `url(#id)` resolves to the first match, the shading froze on the first frame while the
silhouette kept moving. The React renderer never had this bug; it assigns through
`dangerouslySetInnerHTML`, which replaces.

## Motion

Breathing, float, rotation and surface drift are sampled by `sampleBlobMotion(config, time)`, a pure
function. Each of the four runs on its own oscillator — distinct default frequencies and phases,
and surface drift deliberately no longer shares float's oscillator (it used to be a dead knob: the
two moved as one joint motion, which is exactly what the motion guidelines forbid). The studio feeds
it from a single rAF loop writing to Motion values, so React never re-renders per frame.

`prefers-reduced-motion` disables motion **in the renderers themselves**, on both paths: the SVG
`BlobRenderer` checks it per render, and the WebGL side freezes the clock inside `DotWebglCanvas`'s
rAF loop and the exported runtime's `dotScene.update()` (a CSS media query cannot reach a rAF loop). The gate freezes surface
drift, breathing and idle rotation while keeping the composed shape, lights and eye orientation —
the static pose is already the designed look, so nothing has to be recovered.

## GPU path

The GPU adapter shipped as the live renderer — the WebGL2 impostor above — and the diagram the
data model was designed for is now real:

```
BlobConfig
     |
BlobMaterialDefinition
     |
RendererAdapter (DotWebglCanvas)
     +-- WebGL2 impostor   (studio live: editor, preview, animation)
     +-- SVG engine        (fallback, exports, thumbnails, lab oracle)
```

WebGPU stays a future adapter behind the same seam: the pack is a plain uniform record, so a
WebGPURenderer would consume `packBlobWebgl2Uniforms` output without touching the data model, the
editor or the presets.

## Troubleshooting

- **Looks flat** — raise `intensity`, lower `ambient`, and check `quality` is not `low`: without the
  wash layers the lower half has no falloff.
- **Colors look banded** — the OKLCH gamut fit reduced the chroma; pick a less saturated base color.
- **Rim on the wrong side** — `rimStrength` uses a mask derived from the light azimuth; if the light
  is nearly overhead the rim wraps and reads as an outline.
- **Grain differs between preview and export** — the export renders at a different pixel size, and
  `feTurbulence` is resolution-dependent. Same config, same size, same grain.
- **Many blobs on one page** — pass a distinct `idPrefix` per blob.

## The `blob2d` → `softDot` rename

The surface was called `blob2d` while it was still the rejected implementation. The name leaked into
every artifact an avatar carries — the persisted `surface.type`, the `surface.blob2d` params bag, the
standalone engine's `blobConfigFromSurface` export, the generated filter ids — so a finished avatar
advertised a renderer nobody wanted any more. It is now `softDot` throughout.

The engine vocabulary keeps the word _blob_ (`BlobConfig`, `buildBlobScene`, `createBlobMaterial`).
That is deliberate and not an oversight: the fork already owns a **different** surface called `blob`
(the seeded-displacement one), so renaming the material engine to `softDot` would have put two
different things under one name.

`blob2d` survives in exactly three places, all read-only:

| Where                  | Why                                                               |
| ---------------------- | ----------------------------------------------------------------- |
| `SurfaceConfig.blob2d` | `@deprecated` alias of `softDot`, deleted the moment it is parsed |
| `canonicalSurfaceType` | normalizes the type for raw export payloads that skip the parser  |
| the schema's type enum | so an avatar exported before the rename still validates           |

`parseSurfaceConfig` erases the alias on read, so a document that carried it is rewritten in the
canonical shape the first time anything opens it, and nothing new is ever written with the old name.
`soft-dot-surface-test.ts` pins both halves.
