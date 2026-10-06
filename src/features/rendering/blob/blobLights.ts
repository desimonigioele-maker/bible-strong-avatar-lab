/**
 * Multi-light model for the dot material.
 *
 * The old engine had one "light" and hand-placed the consequences of it:
 * a volume ramp, a core shadow, a fill blob and a rim stroke, all mixed with
 * blend modes. That is four arbitrary lights pretending to be one, which is
 * why the result read as a gradient rather than as a lit object.
 *
 * Here there is a real light rig. KEY, FILL, RIM and AMBIENT each have a
 * position, a colour, an intensity and a falloff, and every term of the
 * surface formula is evaluated against the same normal:
 *
 *   D = sum_i  pow(max(dot(N, L_i), 0), e_i) * intensity_i
 *   C = cavity(normal, edgeDistance, curvature)
 *   S = pow(max(dot(N, H), 0), shininess) * specular
 *   F = pow(1 - max(dot(N, V), 0), sheenPower) * sheen
 *   R = pow(1 - max(dot(N, V), 0), rimPower) * rim
 *
 * The lights live in camera space. An object that rotates does not drag its
 * lighting around with it, which is the difference between "a light in the
 * scene" and "a gradient stuck to the blob" (FASI 23, 63, 66).
 */

import { clamp01 } from './blobUtils'

export type Vec3 = { x: number; y: number; z: number }

export type DotLight = {
  position: Vec3
  color: string
  intensity: number
  /** Falloff exponent: low is a broad wrap, high is a tight lobe. */
  falloff: number
  /** Distance beyond which the light contributes nothing. */
  range: number
}

export type LightRig = {
  key: DotLight
  fill: DotLight
  rim: DotLight
  ambient: number
  /** Halfway between the key and the viewer, for the specular lobe. */
  halfVector: Vec3
}

const normalize = ({ x, y, z }: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z)
  return length < 1e-9 ? { x: 0, y: 0, z: 1 } : { x: x / length, y: y / length, z: z / length }
}

const dot = (left: Vec3, right: Vec3): number =>
  left.x * right.x + left.y * right.y + left.z * right.z

/**
 * Distance at which lights are placed, in silhouette radii.
 *
 * A light at distance 1 sits *on* the unit sphere, so every point facing away
 * from it receives exactly nothing and the shadow side goes black. Pushing the
 * rig out to a studio-like distance is what lets a single key wrap far enough
 * around the body to model a soft object.
 */
const LIGHT_DISTANCE = 3.2

/**
 * Places a light from a direction given on the screen.
 *
 * `x` and `y` are in normalized silhouette units, so the same rig works for a
 * 32 px dot and a 1024 px one; `z` is the elevation above the shape plane. The
 * direction is normalized and then pushed out to `LIGHT_DISTANCE`, so the
 * caller authors *where the light comes from*, not its distance.
 */
export const lightFromScreenPosition = (
  x: number,
  y: number,
  z: number,
  color: string,
  intensity: number,
  falloff: number,
  distance = LIGHT_DISTANCE
): DotLight => {
  const direction = normalize({ x, y, z })
  return {
    position: {
      x: direction.x * distance,
      y: direction.y * distance,
      z: direction.z * distance,
    },
    color,
    intensity,
    falloff,
    // The window must always cover the whole body, otherwise the falloff
    // introduces a hard terminator that reads as a seam.
    range: distance + 2,
  }
}

/**
 * Builds the rig.
 *
 * The fill is derived from the key rather than authored independently: a fill
 * that does not sit opposite its key is what makes a render look like four
 * unrelated lights (FASE 62).
 */
export const createLightRig = (input: {
  keyX: number
  keyY: number
  keyZ: number
  keyColor: string
  fillColor: string
  rimColor: string
  intensity: number
  fillIntensity: number
  rimIntensity: number
  ambient: number
  softness: number
}): LightRig => {
  const broad = 0.6 + 1.8 * clamp01(input.softness)
  const key = lightFromScreenPosition(
    input.keyX,
    input.keyY,
    input.keyZ,
    input.keyColor,
    input.intensity,
    broad
  )
  // The fill opposes the key across the shape and sits lower, which is where a
  // real bounce card would be.
  const fill = lightFromScreenPosition(
    -input.keyX * 0.85,
    -input.keyY * 0.5 + 0.25,
    0.55,
    input.fillColor,
    input.fillIntensity,
    broad * 0.7,
    LIGHT_DISTANCE * 0.85
  )
  // The rim lives behind the surface, so it only reaches the grazing angles.
  const rim = lightFromScreenPosition(
    -input.keyX * 0.6,
    -input.keyY * 0.4 - 0.3,
    -0.75,
    input.rimColor,
    input.rimIntensity,
    1.4,
    LIGHT_DISTANCE * 0.7
  )

  return {
    key,
    fill,
    rim,
    ambient: clamp01(input.ambient),
    halfVector: normalize({
      x: key.position.x,
      y: key.position.y,
      z: key.position.z + LIGHT_DISTANCE,
    }),
  }
}

/** Distance from a surface point to a light. */
const lightDistance = (normal: Vec3, light: DotLight): number =>
  Math.hypot(light.position.x - normal.x, light.position.y - normal.y, light.position.z - normal.z)

/** Direction from a surface point to a light, or null when out of range. */
const directionTo = (normal: Vec3, light: DotLight): Vec3 | null => {
  const distance = lightDistance(normal, light)
  if (distance > light.range || distance < 1e-9) return null
  return {
    x: (light.position.x - normal.x) / distance,
    y: (light.position.y - normal.y) / distance,
    z: (light.position.z - normal.z) / distance,
  }
}

/**
 * Soft diffuse with a distance attenuation, never a hard cut.
 *
 * The attenuation is deliberately gentle: an inverse-square law tuned to the
 * silhouette would fall off faster than the object is wide and produce the flat
 * dark smear this renderer used to have.
 */
export const softDiffuse = (normal: Vec3, light: DotLight): number => {
  const direction = directionTo(normal, light)
  if (!direction) return 0
  const lambert = Math.max(0, dot(normal, direction))
  if (lambert <= 0) return 0
  const distance = lightDistance(normal, light)
  const attenuation = 1 / (1 + distance * distance * 0.12)
  return Math.pow(lambert, light.falloff) * light.intensity * attenuation
}

/**
 * Blinn-Phong specular. `V` is the orthographic view direction, so the half
 * vector is `normalize(L + V)`; for a soft material the exponent stays low
 * and the strength low, which is what produces a broad highlight instead of a
 * white dot (FASI 15, 58).
 */
export const softSpecular = (
  normal: Vec3,
  rig: LightRig,
  exponent: number,
  strength: number
): number => {
  if (strength <= 0) return 0
  const direction = directionTo(normal, rig.key)
  if (!direction) return 0
  const halfway = normalize({
    x: direction.x + rig.halfVector.x,
    y: direction.y + rig.halfVector.y,
    z: direction.z + rig.halfVector.z,
  })
  return Math.pow(Math.max(0, dot(normal, halfway)), Math.max(1, exponent)) * strength
}

/**
 * Sheen: brightening towards grazing angles. Retroflection is approximated by
 * the view-facing term, which is enough for a matte or plush surface and keeps
 * the term from turning the body into glass (FASE 16).
 */
export const softSheen = (normal: Vec3, power: number, strength: number): number => {
  if (strength <= 0) return 0
  const view = Math.max(0, normal.z)
  return Math.pow(1 - view, Math.max(0.5, power)) * strength
}

/**
 * Surface-integrated rim: a Fresnel-like edge term evaluated on the normal, not
 * a stroke outside the shape and not an outer glow (FASI 17, 57).
 */
export const softRim = (normal: Vec3, power: number, strength: number): number => {
  if (strength <= 0) return 0
  const view = Math.max(0, normal.z)
  return Math.pow(1 - view, Math.max(0.5, power)) * strength
}

/**
 * Cavity and a light ambient-occlusion approximation.
 *
 * Both come from how far a point is from the silhouette, biased by the surface
 * curvature: irregular regions read as deeper than a clean sphere of the same
 * size. Kept deliberately light, because the failure mode here is a black rim
 * (FASI 18, 19, 57).
 */
export const cavityTerm = (
  edgeDistance: number,
  curvature: number,
  strength: number,
  aoStrength: number
): number => {
  if (strength <= 0 && aoStrength <= 0) return 0
  // 1 at the edge, 0 in the middle; smoothstep keeps the gradient continuous.
  const t = clamp01(1 - edgeDistance)
  const smooth = t * t * (3 - 2 * t)
  const irregularity = clamp01(curvature * 1.6)
  return clamp01(smooth * (strength * (0.6 + 0.4 * irregularity)) + smooth * aoStrength * 0.5)
}

/**
 * The full surface formula, evaluated at one point.
 *
 * Returned as separate terms rather than a finished color: the SVG serializer
 * needs the magnitudes to build gradients, and the GPU path needs them to
 * build a shader, and neither should re-derive the lighting.
 */
export type SurfaceShading = {
  ambient: number
  diffuse: number
  specular: number
  sheen: number
  rim: number
  cavity: number
  /** ambient + diffuse, the multiplier for the base color. */
  diffuseField: number
}

export const shadeSurface = (input: {
  normal: Vec3
  edgeDistance: number
  curvature: number
  rig: LightRig
  roughness: number
  specular: number
  specularPower: number
  sheen: number
  sheenPower: number
  rim: number
  rimPower: number
  cavityStrength: number
  aoStrength: number
}): SurfaceShading => {
  const key = softDiffuse(input.normal, input.rig.key)
  const fill = softDiffuse(input.normal, input.rig.fill)
  const rimLight = softDiffuse(input.normal, input.rig.rim)
  const diffuse = key + fill * 0.6 + rimLight * 0.35

  // Rougher surfaces spread the highlight: a low exponent reads as velvet, a
  // high exponent as polished. The scale keeps a "soft" material genuinely
  // soft, because a tight lobe on a plush body is exactly what makes a render
  // look like a plastic bead instead of a tactile surface.
  const exponent = Math.max(
    2.5,
    input.specularPower * (1.6 - clamp01(input.roughness) * 0.9) * 0.35
  )
  const specular = softSpecular(input.normal, input.rig, exponent, input.specular)
  const sheen = softSheen(input.normal, input.sheenPower, input.sheen)
  const rim = softRim(input.normal, input.rimPower, input.rim) + rimLight * input.rim * 0.25
  const cavity = cavityTerm(
    input.edgeDistance,
    input.curvature,
    input.cavityStrength,
    input.aoStrength
  )

  return {
    ambient: input.rig.ambient,
    diffuse,
    specular,
    sheen,
    rim,
    cavity,
    diffuseField: input.rig.ambient + diffuse,
  }
}
