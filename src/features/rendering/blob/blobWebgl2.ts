/**
 * WebGL2 impostor renderer for the dot — the primary live renderer.
 *
 * The dot is NOT a real 3D mesh. It is a 2.5D procedural impostor: one
 * fullscreen triangle, one fragment shader. Per pixel the shader rebuilds the
 * exact surface the SVG engine derives in TypeScript:
 *
 *   implicit surface (silhouette LUT + pseudo-sphere z)
 *   → normal field (+ seeded noise deformation, shape-aware)
 *   → camera-space multi-light (the very LightRig the SVG path builds)
 *   → soft diffuse / broad specular / sheen / rim
 *   → cavity + AO weighted against the light
 *   → OKLab ramp (shadow → base → highlight, cavity-weighted)
 *   → macro / medium / micro noise + colour spots
 *   → soft tone map
 *
 * The light rig, the palette, the peak normalisation and the surface field are
 * computed by the SAME domain functions the SVG renderer uses
 * (`buildBlobLighting` → `createLightRig`, `createBlobMaterial`,
 * `buildDotSurfaceField`), so the two renderers cannot disagree about where
 * the light is or what the material is. React never renders per frame: the
 * animation loop writes uniforms only.
 *
 * Determinism: every noise term is a pure function of the blob seed, so the
 * same shape + seed + material + lighting produces the same static image.
 *
 * No Three.js: an impostor needs a quad and a shader, not a scene graph.
 */

import { hexToRgb, shiftColor } from './blobColor'
import { normalizeBlobConfig } from './blobConfig'
import { buildBlobGeometry } from './blobGeometry'
import { buildBlobLighting } from './blobLighting'
import { createBlobMaterial } from './blobMaterial'
import { buildDotSurfaceField, restPose } from './blobSvg'
import { clamp01 } from './blobUtils'
import type { BlobConfig, RenderQuality } from './blobTypes'

export type Vec3Tuple = [number, number, number]

/** The motion sample the SVG engine also consumes (`sampleBlobMotion`). */
export type Webgl2MotionSample = {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
  rotation: number
}

export type BlobWebgl2Uniforms = {
  // Frame
  uResolution: [number, number]
  // Silhouette (viewBox units ÷ 160, matching the SVG's 320-unit box)
  uCenter: [number, number]
  uRadiusLut: Float32Array
  uZScale: number
  uCurvature: number
  uDeform: number
  uEdgeNoise: number
  uSeed: number
  // Motion (camera-anchored lights; only the body moves)
  uScale: [number, number]
  uTranslate: [number, number]
  uRotation: number
  // Palette (sRGB 0..1)
  uShadow: Vec3Tuple
  uBase: Vec3Tuple
  uMidtone: Vec3Tuple
  uHighlight: Vec3Tuple
  uCavityColor: Vec3Tuple
  uRimColor: Vec3Tuple
  uSheenColor: Vec3Tuple
  uSpotA: Vec3Tuple
  uSpotB: Vec3Tuple
  // Light rig (camera space, straight from `createLightRig`)
  uKeyPos: Vec3Tuple
  uFillPos: Vec3Tuple
  uRimPos: Vec3Tuple
  uKeyColor: Vec3Tuple
  uFillColor: Vec3Tuple
  uRimLightColor: Vec3Tuple
  uKeyIntensity: number
  uFillIntensity: number
  uRimIntensity: number
  uKeyFall: number
  uFillFall: number
  uRimFall: number
  uKeyRange: number
  uFillRange: number
  uRimRange: number
  uHalfVector: Vec3Tuple
  uAmbient: number
  uPeak: number
  // Material response
  uRoughness: number
  uSpecularPower: number
  uSpecularStrength: number
  uSpecColor: Vec3Tuple
  uSheenPower: number
  uSheenStrength: number
  uRimPower: number
  uRimScale: number
  uCavityScale: number
  uAoStrength: number
  uShadowStrength: number
  // Surface detail
  uMacroNoise: number
  uMicroNoise: number
  uFiber: number
  uColorVariation: number
  uQuality: number
  uTintCol: Vec3Tuple
  uTintAmt: number
}

const VIEWBOX_HALF = 160
const LUT_SIZE = 32

export const DOT_WEBGL2_VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const DOT_WEBGL2_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uRadiusLut[${LUT_SIZE}];
uniform float uZScale;
uniform float uCurvature;
uniform float uDeform;
uniform float uEdgeNoise;
uniform float uSeed;
uniform vec2 uScale;
uniform vec2 uTranslate;
uniform float uRotation;

uniform vec3 uShadow;
uniform vec3 uBase;
uniform vec3 uMidtone;
uniform vec3 uHighlight;
uniform vec3 uCavityColor;
uniform vec3 uRimColor;
uniform vec3 uSheenColor;
uniform vec3 uSpotA;
uniform vec3 uSpotB;

uniform vec3 uKeyPos;
uniform vec3 uFillPos;
uniform vec3 uRimPos;
uniform vec3 uKeyColor;
uniform vec3 uFillColor;
uniform vec3 uRimLightColor;
uniform float uKeyIntensity;
uniform float uFillIntensity;
uniform float uRimIntensity;
uniform float uKeyFall;
uniform float uFillFall;
uniform float uRimFall;
uniform float uKeyRange;
uniform float uFillRange;
uniform float uRimRange;
uniform vec3 uHalfVector;
uniform float uAmbient;
uniform float uPeak;

uniform float uRoughness;
uniform float uSpecularPower;
uniform float uSpecularStrength;
uniform vec3 uSpecColor;
uniform float uSheenPower;
uniform float uSheenStrength;
uniform float uRimPower;
uniform float uRimScale;
uniform float uCavityScale;
uniform float uAoStrength;
uniform float uShadowStrength;

uniform float uMacroNoise;
uniform float uMicroNoise;
uniform float uFiber;
uniform float uColorVariation;
uniform float uQuality;
uniform vec3 uTintCol;
uniform float uTintAmt;

// ---------------------------------------------------------------------------
// Deterministic hash noise. Same seed, same field, every run.
// ---------------------------------------------------------------------------
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p) {
  return vnoise(p) * 0.65 + vnoise(p * 2.17 + 19.7) * 0.35;
}

// ---------------------------------------------------------------------------
// OKLab mixing — the same perceptual ramp the SVG engine walks in TypeScript
// (mixOklab). sRGB interpolation sheds chroma exactly in the midtones.
// ---------------------------------------------------------------------------
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  vec3 g = max(c, vec3(0.0));
  return mix(g * 12.92, 1.055 * pow(g, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), g));
}

vec3 linearToOklab(vec3 c) {
  float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
  float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
  float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
  l = pow(max(l, 0.0), 1.0 / 3.0);
  m = pow(max(m, 0.0), 1.0 / 3.0);
  s = pow(max(s, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  );
}

vec3 oklabToLinear(vec3 c) {
  float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 oklabMix(vec3 a, vec3 b, float t) {
  vec3 A = linearToOklab(srgbToLinear(a));
  vec3 B = linearToOklab(srgbToLinear(b));
  return linearToSrgb(oklabToLinear(mix(A, B, clamp(t, 0.0, 1.0))));
}

// ---------------------------------------------------------------------------
// Light terms — mirror of blobLights.ts (softDiffuse / softSpecular /
// softSheen / softRim / cavityTerm), evaluated against the pseudo-sphere.
// ---------------------------------------------------------------------------
float lightAttenuation(float distance) {
  return 1.0 / (1.0 + distance * distance * 0.12);
}

float softDiffuse(vec3 n, vec3 lightPos, float falloff, float intensity, float range) {
  vec3 toLight = lightPos - n;
  float distance = length(toLight);
  if (distance > range || distance < 1e-9) return 0.0;
  vec3 dir = toLight / distance;
  float lambert = max(dot(n, dir), 0.0);
  if (lambert <= 0.0) return 0.0;
  return pow(lambert, falloff) * intensity * lightAttenuation(distance);
}

float lutRadius(float angle) {
  float idx = (angle + 3.14159265) / 6.2831853 * ${LUT_SIZE}.0;
  int i0 = int(floor(idx)) % ${LUT_SIZE};
  int i1 = (i0 + 1) % ${LUT_SIZE};
  return mix(uRadiusLut[i0], uRadiusLut[i1], fract(idx));
}

void main() {
  float halfMin = 0.5 * min(uResolution.x, uResolution.y);
  // y is negated on purpose: the shader must live in the SAME frame as the
  // SVG engine (viewBox y-down, +y on screen is negative), or a
  // key-upper-left rig lights the lower-left dot and the two renderers of one
  // material disagree about where the light is.
  vec2 uv = vec2(gl_FragCoord.x - 0.5 * uResolution.x, 0.5 * uResolution.y - gl_FragCoord.y) / halfMin;

  // Motion transforms the body only; the light rig stays camera-anchored.
  float cr = cos(uRotation);
  float sr = sin(uRotation);
  vec2 q = mat2(cr, -sr, sr, cr) * (uv - uCenter - uTranslate);
  q /= max(uScale, vec2(1e-3));

  float r = length(q);
  float ang = atan(q.y, q.x);

  // The silhouette is the SVG engine's own parametric outline, binned to a
  // radial LUT, plus a whisper of macro wobble: a mathematically perfect
  // circle is exactly what the dot must not look like.
  float shapeR = lutRadius(ang);
  shapeR *= 1.0 + (fbm2(vec2(ang * 3.0, uSeed * 0.017)) - 0.5) * uEdgeNoise;
  float rn = r / max(shapeR, 1e-3);
  float aa = fwidth(rn) * 1.4 + 1e-4;
  float coverage = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, rn);
  if (coverage <= 0.002) discard;

  // Pseudo-spherical surface: z from the radial coordinate, normal from the
  // gradient of that height field — the impostor's whole third dimension.
  float r2 = min(rn * rn, 1.0);
  float z = sqrt(max(0.0, 1.0 - r2));
  vec2 radial = q / max(shapeR, 1e-3);
  vec3 n = normalize(vec3(radial, max(z, 1e-4) * uZScale));

  // Shape-aware deformation: macro breaks the perfect sphere, medium adds
  // organicity. Both deterministic in the seed, both perturbing the NORMAL
  // (the surface responds to light), never painting texture on top.
  vec3 dMacro = vec3(
    fbm2(q * 2.0 + uSeed * 0.13),
    fbm2(q * 2.0 + uSeed * 0.13 + 31.7),
    fbm2(q * 1.7 + uSeed * 0.13 + 91.3)
  ) - 0.5;
  n = normalize(n + dMacro * uDeform * 0.9);
  vec3 dMed = vec3(
    vnoise(q * 7.0 + uSeed * 0.29),
    vnoise(q * 7.0 + uSeed * 0.29 + 13.1),
    vnoise(q * 6.3 + uSeed * 0.29 + 57.7)
  ) - 0.5;
  n = normalize(n + dMed * 0.06 * (0.35 + uFiber));

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float ndv = max(n.z, 0.0);

  // Camera-space multi-light, same weights as shadeSurface: key + fill·0.6 +
  // rimLight·0.35. Nothing is glued to the texture: the body moves inside the
  // rig.
  float keyD = softDiffuse(n, uKeyPos, uKeyFall, uKeyIntensity, uKeyRange);
  float fillD = softDiffuse(n, uFillPos, uFillFall, uFillIntensity, uFillRange) * 0.6;
  float rimD = softDiffuse(n, uRimPos, uRimFall, uRimIntensity, uRimRange) * 0.35;
  float diffuse = keyD + fillD + rimD;
  float lit = clamp(diffuse / max(uPeak, 1e-4), 0.0, 1.0);

  // The OKLab ramp: shadow → base by the light, then the highlight window in
  // the top third where a real highlight lives.
  vec3 albedo = oklabMix(uShadow, uBase, lit);
  float highlight = lit * lit * (3.0 - 2.0 * lit) * lit;
  albedo = oklabMix(albedo, uHighlight, highlight * (1.0 - uRoughness * 0.35));

  // Cavity + AO from edge distance and curvature, weighted AGAINST the light
  // (a crevice turned toward the key is not in shadow). Mirrors cavityTerm.
  float edge = 1.0 - z;
  float smoothEdge = edge * edge * (3.0 - 2.0 * edge);
  float irregular = clamp(uCurvature * 1.6, 0.0, 1.0);
  float cavity = clamp(smoothEdge * (0.6 + 0.4 * irregular) + smoothEdge * uAoStrength, 0.0, 1.0);
  albedo = oklabMix(albedo, uCavityColor, cavity * uCavityScale * (1.0 - lit * 0.65));

  // Three scales of surface detail, all luminance modulation of the ramp —
  // the texture is *lit*, never painted on top:
  //   macro — very slow tonal unevenness, breaks mathematical perfection;
  //   nap/fiber — few-pixel tactile grain, the soft digital material itself;
  //   micro — per-pixel richness, almost invisible at distance.
  // The frequencies sit where the eye reads material at preview scale: the
  // reference artwork's local gradients measure 4.5–5.6, and a surface below
  // that reads as a smooth ball however good its lighting is.
  float macro = fbm2(q * 2.2 + uSeed * 0.41);
  albedo *= 1.0 + macro * uMacroNoise * 0.06;
  float microGate = uQuality >= 2.5 ? 1.0 : (uQuality >= 1.5 ? 0.6 : 0.0);
  float nap = vnoise(q * 150.0 + uSeed * 1.9) - 0.5;
  float fiberN = vnoise(q * 260.0 + uSeed * 1.3) - 0.5;
  float micro = hash12(q * 320.0 + uSeed * 0.77) - 0.5;
  float detail =
    nap * (0.135 + uFiber * 0.2) + fiberN * uFiber * 0.07 + micro * uMicroNoise * 0.2;
  albedo *= 1.0 + detail * microGate;

  // Colour spots: two hue-shifted fields at the elegant 0.01–0.05 amplitude.
  float lobe1 = smoothstep(0.45, 0.9, fbm2(q * 1.6 + uSeed * 0.53));
  float lobe2 = smoothstep(0.45, 0.9, fbm2(q * 1.9 + uSeed * 0.97));
  albedo = mix(albedo, uSpotA, lobe1 * uColorVariation * 2.6);
  albedo = mix(albedo, uSpotB, lobe2 * uColorVariation * 2.6);

  // Plush nap: the studio's texture tint catches grazing light, never a
  // uniform overlay.
  if (uTintAmt > 0.001) {
    float nap = smoothstep(0.55, 0.95, vnoise(q * 140.0 + uSeed * 0.71));
    albedo = mix(albedo, uTintCol, nap * uTintAmt * 0.22 * (0.35 + 0.65 * (1.0 - ndv)));
  }

  // Broad Blinn-Phong specular on the rig's own half vector — soft material,
  // low exponent, low strength: a broad highlight, never a white dot.
  vec3 dirKey = normalize(uKeyPos - n);
  vec3 halfway = normalize(dirKey + uHalfVector);
  float spec = pow(max(dot(n, halfway), 0.0), max(1.0, uSpecularPower)) * uSpecularStrength;
  spec *= step(1e-4, keyD);

  // Rim on the surface (Fresnel), sheen as grazing brightening: both stay
  // inside the silhouette, never an outer glow.
  float fres = pow(1.0 - ndv, max(0.5, uRimPower));
  float rim = (fres + rimD * 0.25) * uRimScale;
  float sheen = pow(1.0 - ndv, max(0.5, uSheenPower)) * uSheenStrength;

  vec3 color = albedo;
  color = mix(color, uRimColor, clamp(rim, 0.0, 0.7));
  color = mix(color, uSheenColor, clamp(sheen, 0.0, 0.45));
  color += uSpecColor * spec * (1.0 - uRoughness * 0.4);

  // The shadow side stays deep but alive.
  color *= 1.0 - uShadowStrength * 0.18 * smoothEdge * (1.0 - lit);

  // Soft tone map: highlights roll off instead of clipping to flat white.
  color = color / (1.0 + max(color - 0.82, 0.0) * 0.85);

  fragColor = vec4(max(color, 0.0) * coverage, coverage);
}
`

const QUALITY_LEVEL: Record<RenderQuality, number> = { low: 0, medium: 1, high: 2, ultra: 3 }

const rgbTuple = (hex: string): Vec3Tuple => {
  const { r, g, b } = hexToRgb(hex)
  return [r / 255, g / 255, b / 255]
}

/**
 * Bins the geometry outline into a radial LUT at fixed angles.
 *
 * The silhouette must be the SAME outline the SVG body path draws
 * (`buildBlobGeometry(config.shape)`), so the two renderers cannot drift
 * apart. Radii are viewBox units ÷ 160, matching the shader's uv space.
 */
export const silhouetteLut = (config: BlobConfig, size = LUT_SIZE): Float32Array => {
  const geometry = buildBlobGeometry(config.shape)
  const lut = new Float32Array(size)
  const filled = new Uint8Array(size)
  for (const point of geometry.points) {
    const radius = Math.hypot(point.x, point.y)
    if (!(radius > 1e-6)) continue
    const angle = Math.atan2(point.y, point.x)
    const slot = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * size) % size
    const normalized = radius / VIEWBOX_HALF
    if (normalized > lut[slot]) {
      lut[slot] = normalized
      filled[slot] = 1
    }
  }
  // Fill gaps (sparse outlines) from the nearest filled neighbour, wrapping.
  const fallback = 108 / VIEWBOX_HALF
  for (let index = 0; index < size; index += 1) {
    if (filled[index]) continue
    let best = fallback
    let bestDistance = Number.POSITIVE_INFINITY
    for (let offset = 1; offset < size; offset += 1) {
      const before = (index - offset + size * 2) % size
      const after = (index + offset) % size
      if (filled[before]) {
        best = lut[before]
        bestDistance = offset
        break
      }
      if (filled[after] && offset < bestDistance) {
        best = lut[after]
        bestDistance = offset
      }
    }
    lut[index] = best
  }
  return lut
}

/**
 * Packs the renderer-independent model (config + pose + motion) into shader
 * uniforms. Every value comes from the same domain functions the SVG path
 * uses — the pack re-derives nothing.
 */
export const packBlobWebgl2Uniforms = (input: {
  config: BlobConfig
  quality?: RenderQuality
  motion?: Webgl2MotionSample
  /** Studio texture finish: plush nap tinted to its own colour. */
  tint?: { color: string; amount: number } | null
  size?: { width: number; height: number }
}): BlobWebgl2Uniforms => {
  const config = normalizeBlobConfig(input.config)
  const quality = input.quality ?? config.quality
  const material = createBlobMaterial(config.material)
  const pose = config.pose ?? restPose()
  const field = buildDotSurfaceField(pose, config)
  const lighting = buildBlobLighting(
    config.lighting,
    material,
    field,
    quality,
    config.shape.seed,
    config.material.deformation
  )
  const rig = lighting.rig
  // The ramp's normaliser: the strongest diffuse the sampled surface receives.
  const peak = Math.max(1e-4, lighting.stats.maxDiffuse - rig.ambient)
  const radius = Math.max(field.radiusX, field.radiusY) / VIEWBOX_HALF

  const motion: Webgl2MotionSample = input.motion ?? {
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
    rotation: 0,
  }

  const roughness = clamp01(material.roughness)
  // Same exponent coupling as shadeSurface: rougher surfaces spread the lobe.
  const specularPower = Math.max(2.5, material.specularPower * (1.6 - roughness * 0.9) * 0.35)
  // The specular stroke in the SVG path is the highlight colour lifted a
  // step; screened over the tinted body it reads as material, not as paint.
  const highlightRgb = rgbTuple(material.palette.highlight)
  const specColor: Vec3Tuple = [
    Math.min(1, highlightRgb[0] + 0.12),
    highlightRgb[1],
    highlightRgb[2],
  ]

  return {
    uResolution: [input.size?.width ?? 512, input.size?.height ?? 512],
    uCenter: [0, 0],
    uRadiusLut: silhouetteLut(config),
    uZScale: clamp01(field.centerDepth / Math.max(radius * VIEWBOX_HALF, 1e-3)) * 0.7 + 0.3,
    uCurvature: clamp01(field.curvature),
    uDeform: clamp01(config.material.deformation),
    uEdgeNoise: clamp01(config.material.macroNoise) * 0.035,
    uSeed: config.shape.seed % 100000,
    uScale: [motion.scaleX, motion.scaleY],
    uTranslate: [motion.translateX / VIEWBOX_HALF, motion.translateY / VIEWBOX_HALF],
    uRotation: (motion.rotation * Math.PI) / 180,

    uShadow: rgbTuple(material.palette.shadow),
    uBase: rgbTuple(material.palette.base),
    uMidtone: rgbTuple(material.palette.midtone),
    uHighlight: rgbTuple(material.palette.highlight),
    uCavityColor: rgbTuple(material.palette.cavity),
    uRimColor: rgbTuple(material.palette.rim),
    uSheenColor: rgbTuple(material.palette.sheen),
    uSpotA: rgbTuple(shiftColor(material.palette.base, { hue: 26 })),
    uSpotB: rgbTuple(shiftColor(material.palette.base, { hue: -20 })),

    uKeyPos: [rig.key.position.x, rig.key.position.y, rig.key.position.z],
    uFillPos: [rig.fill.position.x, rig.fill.position.y, rig.fill.position.z],
    uRimPos: [rig.rim.position.x, rig.rim.position.y, rig.rim.position.z],
    uKeyColor: rgbTuple(rig.key.color),
    uFillColor: rgbTuple(rig.fill.color),
    uRimLightColor: rgbTuple(rig.rim.color),
    uKeyIntensity: rig.key.intensity,
    uFillIntensity: rig.fill.intensity,
    uRimIntensity: rig.rim.intensity,
    uKeyFall: rig.key.falloff,
    uFillFall: rig.fill.falloff,
    uRimFall: rig.rim.falloff,
    uKeyRange: rig.key.range,
    uFillRange: rig.fill.range,
    uRimRange: rig.rim.range,
    uHalfVector: [rig.halfVector.x, rig.halfVector.y, rig.halfVector.z],
    uAmbient: rig.ambient,
    uPeak: peak,

    uRoughness: roughness,
    uSpecularPower: specularPower,
    uSpecularStrength: material.specularStrength,
    uSpecColor: specColor,
    uSheenPower: 3.2,
    uSheenStrength: material.sheen,
    uRimPower: 2.6,
    uRimScale: 0.32 + config.lighting.rimStrength * material.rimBoost * 0.28,
    uCavityScale: 0.55 * (0.45 + 0.55 * config.lighting.cavityStrength),
    uAoStrength: config.lighting.aoStrength * 0.5,
    uShadowStrength: config.lighting.shadowStrength,

    uMacroNoise: material.macroNoise,
    uMicroNoise: material.microNoise,
    uFiber: material.fiber,
    uColorVariation: clamp01(material.colorVariation),
    uQuality: QUALITY_LEVEL[quality] ?? 3,
    uTintCol: rgbTuple(input.tint?.color ?? material.palette.highlight),
    uTintAmt: input.tint?.amount ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Renderer creation. DOM only inside the functions: the module stays
// importable in node (tests pack uniforms without a GL context).
// ---------------------------------------------------------------------------

export type BlobWebgl2Handle = {
  render: (uniforms: BlobWebgl2Uniforms, width: number, height: number) => void
  dispose: () => void
}

export const hasWebgl2 = (): boolean =>
  typeof document !== 'undefined' &&
  typeof document.createElement === 'function' &&
  document.createElement('canvas').getContext('webgl2') !== null

type UniformDecl = { name: string; type: string }

/** Declarations the pack must satisfy — parsed from the shader source. */
export const dotWebgl2UniformDecls = (): UniformDecl[] => {
  const source = DOT_WEBGL2_VERTEX + DOT_WEBGL2_FRAGMENT
  const decls: UniformDecl[] = []
  const pattern = /uniform\s+(float|vec2|vec3|int)\s+([A-Za-z0-9_]+)(\[\d+\])?;/g
  for (const match of source.matchAll(pattern)) {
    decls.push({ name: match[2], type: match[3] ? `${match[1]}[]` : match[1] })
  }
  return decls
}

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * Creates the impostor renderer on a canvas, or returns null when WebGL2 is
 * unavailable — the caller falls back to the SVG renderer, which is the
 * contract this adapter exists for.
 */
export const createBlobWebgl2 = (canvas: HTMLCanvasElement): BlobWebgl2Handle | null => {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  })
  if (!gl) return null
  const vertex = compileShader(gl, gl.VERTEX_SHADER, DOT_WEBGL2_VERTEX)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, DOT_WEBGL2_FRAGMENT)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return null
  }
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  const vao = gl.createVertexArray()

  const locations = new Map<string, { location: WebGLUniformLocation; type: string }>()
  for (const decl of dotWebgl2UniformDecls()) {
    const lookupName = decl.type.endsWith('[]') ? `${decl.name}[0]` : decl.name
    const location = gl.getUniformLocation(program, lookupName)
    if (location) locations.set(decl.name, { location, type: decl.type })
  }

  const apply = (uniforms: BlobWebgl2Uniforms) => {
    const entries = locations
    const set1 = (name: string, value: number) => {
      const entry = entries.get(name)
      if (entry) gl.uniform1f(entry.location, value)
    }
    const set2 = (name: string, value: [number, number]) => {
      const entry = entries.get(name)
      if (entry) gl.uniform2f(entry.location, value[0], value[1])
    }
    const set3 = (name: string, value: Vec3Tuple) => {
      const entry = entries.get(name)
      if (entry) gl.uniform3f(entry.location, value[0], value[1], value[2])
    }
    set2('uResolution', uniforms.uResolution)
    set2('uCenter', uniforms.uCenter)
    const lut = entries.get('uRadiusLut')
    if (lut) gl.uniform1fv(lut.location, uniforms.uRadiusLut)
    set1('uZScale', uniforms.uZScale)
    set1('uCurvature', uniforms.uCurvature)
    set1('uDeform', uniforms.uDeform)
    set1('uEdgeNoise', uniforms.uEdgeNoise)
    set1('uSeed', uniforms.uSeed)
    set2('uScale', uniforms.uScale)
    set2('uTranslate', uniforms.uTranslate)
    set1('uRotation', uniforms.uRotation)
    set3('uShadow', uniforms.uShadow)
    set3('uBase', uniforms.uBase)
    set3('uMidtone', uniforms.uMidtone)
    set3('uHighlight', uniforms.uHighlight)
    set3('uCavityColor', uniforms.uCavityColor)
    set3('uRimColor', uniforms.uRimColor)
    set3('uSheenColor', uniforms.uSheenColor)
    set3('uSpotA', uniforms.uSpotA)
    set3('uSpotB', uniforms.uSpotB)
    set3('uKeyPos', uniforms.uKeyPos)
    set3('uFillPos', uniforms.uFillPos)
    set3('uRimPos', uniforms.uRimPos)
    set3('uKeyColor', uniforms.uKeyColor)
    set3('uFillColor', uniforms.uFillColor)
    set3('uRimLightColor', uniforms.uRimLightColor)
    set1('uKeyIntensity', uniforms.uKeyIntensity)
    set1('uFillIntensity', uniforms.uFillIntensity)
    set1('uRimIntensity', uniforms.uRimIntensity)
    set1('uKeyFall', uniforms.uKeyFall)
    set1('uFillFall', uniforms.uFillFall)
    set1('uRimFall', uniforms.uRimFall)
    set1('uKeyRange', uniforms.uKeyRange)
    set1('uFillRange', uniforms.uFillRange)
    set1('uRimRange', uniforms.uRimRange)
    set3('uHalfVector', uniforms.uHalfVector)
    set1('uAmbient', uniforms.uAmbient)
    set1('uPeak', uniforms.uPeak)
    set1('uRoughness', uniforms.uRoughness)
    set1('uSpecularPower', uniforms.uSpecularPower)
    set1('uSpecularStrength', uniforms.uSpecularStrength)
    set3('uSpecColor', uniforms.uSpecColor)
    set1('uSheenPower', uniforms.uSheenPower)
    set1('uSheenStrength', uniforms.uSheenStrength)
    set1('uRimPower', uniforms.uRimPower)
    set1('uRimScale', uniforms.uRimScale)
    set1('uCavityScale', uniforms.uCavityScale)
    set1('uAoStrength', uniforms.uAoStrength)
    set1('uShadowStrength', uniforms.uShadowStrength)
    set1('uMacroNoise', uniforms.uMacroNoise)
    set1('uMicroNoise', uniforms.uMicroNoise)
    set1('uFiber', uniforms.uFiber)
    set1('uColorVariation', uniforms.uColorVariation)
    set1('uQuality', uniforms.uQuality)
    set3('uTintCol', uniforms.uTintCol)
    set1('uTintAmt', uniforms.uTintAmt)
  }

  return {
    render(uniforms, width, height) {
      gl.viewport(0, 0, Math.max(1, width), Math.max(1, height))
      gl.useProgram(program)
      gl.bindVertexArray(vao)
      apply(uniforms)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    dispose() {
      gl.deleteProgram(program)
      gl.deleteVertexArray(vao)
    },
  }
}

/**
 * Renderer-level reduced motion: a CSS media query cannot reach a rAF loop.
 * Frozen pose means static drift, breathing and rotation — the composed shape
 * is already the designed look.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
