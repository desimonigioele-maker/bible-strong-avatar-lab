import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

import {
  defaultDotSoftness,
  defaultDotSurfaceParams as defaultDotParams,
  dotSoftnessPresets,
  type DotSurfaceParams,
} from '@bible-strong/avatar-core'

import {
  DISPLACEMENT_FIELD_GLSL,
  SIMPLEX_NOISE_GLSL,
  SSS_PATCH_GLSL,
  VERTEX_PATCH_GLSL,
} from './dotShaders'

export type { DotSurfaceParams }
export { defaultDotParams }

const CAMERA_POSITION: [number, number, number] = [0, 0.35, 5.2]
const CAMERA_FOV = 35
const GROUND_Y = -1.42

const hexToLinear = (hex: string) => new THREE.Color(hex).convertSRGBToLinear()

export type DotScene = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  render: (renderer: THREE.WebGLRenderer) => void
  update: (elapsedSeconds: number, deltaSeconds: number) => void
  setParams: (params: DotSurfaceParams) => void
  resize: (width: number, height: number) => void
  dispose: () => void
}

type Shared = {
  geometry: THREE.SphereGeometry
  eyeGeometry: THREE.SphereGeometry
  catchlightGeometry: THREE.SphereGeometry
  groundGeometry: THREE.CircleGeometry
  material: THREE.MeshPhysicalMaterial
  eyeMaterial: THREE.MeshPhysicalMaterial
  catchlightMaterial: THREE.MeshBasicMaterial
  shadowMaterial: THREE.ShadowMaterial
  envMap: THREE.Texture
  blobGroup: THREE.Group
  leftEye: THREE.Group
  rightEye: THREE.Group
  uniforms: {
    uTime: { value: number }
    uAmp: { value: number }
    uFreq: { value: number }
    uSeed: { value: number }
    uSSSColor: { value: THREE.Color }
    uSSSStrength: { value: number }
  }
}

const sharedCache = new Map<number, Shared>()

/**
 * One geometry + material set per segment count (64 mobile / 128 desktop).
 * Materials are compiled once and reused across every dot instance, which
 * keeps shader compilation out of interaction paths.
 */
export const getSharedDotResources = (nSegments: number): Shared => {
  const cached = sharedCache.get(nSegments)
  if (cached) return cached

  const geometry = new THREE.SphereGeometry(1, nSegments, nSegments)
  const eyeGeometry = new THREE.SphereGeometry(0.115, 32, 32)
  const catchlightGeometry = new THREE.SphereGeometry(0.05, 16, 16)
  const groundGeometry = new THREE.CircleGeometry(3, 48)

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: defaultDotParams.wobble },
    uFreq: { value: 1.6 },
    uSeed: { value: defaultDotParams.seed },
    uSSSColor: { value: hexToLinear(defaultDotParams.sssColor) },
    uSSSStrength: { value: defaultDotParams.sssStrength },
  }

  const material = new THREE.MeshPhysicalMaterial({
    color: hexToLinear(defaultDotParams.color),
    roughness: dotSoftnessPresets[defaultDotParams.softness ?? defaultDotSoftness].roughness,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.45,
    sheen: 0.6,
    envMapIntensity: 0.9,
  })
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${SIMPLEX_NOISE_GLSL}\n${DISPLACEMENT_FIELD_GLSL}`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `${VERTEX_PATCH_GLSL}\n#include <beginnormal_vertex>\nobjectNormal = wobbleNormal;`
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = wobbleDisplaced;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nuniform float uAmp;\nuniform float uFreq;\nuniform float uSeed;\nuniform vec3 uSSSColor;\nuniform float uSSSStrength;`
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n${SSS_PATCH_GLSL}`
      )
  }
  material.customProgramCacheKey = () => 'dot-blob-v1'

  const eyeMaterial = new THREE.MeshPhysicalMaterial({
    color: hexToLinear('#0b0b10'),
    roughness: 0.12,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  })
  const catchlightMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  })
  const shadowMaterial = new THREE.ShadowMaterial({ opacity: 0.35 })

  const envMap = createRoomEnvironmentTexture()

  const blobGroup = new THREE.Group()
  const blob = new THREE.Mesh(geometry, material)
  blob.castShadow = true
  blobGroup.add(blob)
  const leftEye = createEye(
    blobGroup,
    eyeGeometry,
    catchlightGeometry,
    eyeMaterial,
    catchlightMaterial,
    -1
  )
  const rightEye = createEye(
    blobGroup,
    eyeGeometry,
    catchlightGeometry,
    eyeMaterial,
    catchlightMaterial,
    1
  )

  const shared: Shared = {
    geometry,
    eyeGeometry,
    catchlightGeometry,
    groundGeometry,
    material,
    eyeMaterial,
    catchlightMaterial,
    shadowMaterial,
    envMap,
    blobGroup,
    leftEye,
    rightEye,
    uniforms,
  }
  sharedCache.set(nSegments, shared)
  return shared
}

const createEye = (
  parent: THREE.Group,
  eyeGeometry: THREE.SphereGeometry,
  catchlightGeometry: THREE.SphereGeometry,
  eyeMaterial: THREE.MeshPhysicalMaterial,
  catchlightMaterial: THREE.MeshBasicMaterial,
  side: -1 | 1
): THREE.Group => {
  const eye = new THREE.Group()
  eye.position.set(side * 0.38, 0.18, 0.9)
  const eyeball = new THREE.Mesh(eyeGeometry, eyeMaterial)
  eyeball.scale.set(1, 1.25, 0.55)
  const catchlight = new THREE.Mesh(catchlightGeometry, catchlightMaterial)
  catchlight.position.set(0.06, 0.09, 0.13)
  eye.add(eyeball, catchlight)
  parent.add(eye)
  return eye
}

const createRoomEnvironmentTexture = () => {
  const pmremScene = new RoomEnvironment()
  const pmremRenderer = new THREE.WebGLRenderer({ antialias: false })
  const pmrem = new THREE.PMREMGenerator(pmremRenderer)
  const texture = pmrem.fromScene(pmremScene, 0.04).texture
  pmrem.dispose()
  pmremRenderer.dispose()
  return texture
}

export const buildDotScene = (params: DotSurfaceParams, nSegments: number): DotScene => {
  const shared = getSharedDotResources(nSegments)

  const scene = new THREE.Scene()
  scene.environment = shared.envMap

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100)
  camera.position.set(...CAMERA_POSITION)
  camera.lookAt(0, 0, 0)

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x334455, 0.42)
  const key = new THREE.DirectionalLight(0xfff2e0, 1.9)
  key.position.set(2.5, 3.5, 2.5)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.radius = 8
  key.shadow.camera.near = 1
  key.shadow.camera.far = 12
  key.shadow.camera.left = -3
  key.shadow.camera.right = 3
  key.shadow.camera.top = 3
  key.shadow.camera.bottom = -3
  const rim = new THREE.DirectionalLight(0xff4fd8, 2.1)
  rim.position.set(-2.5, 1.5, -2.5)
  const fill = new THREE.DirectionalLight(0x7ab8ff, 0.6)
  fill.position.set(-3, 0.5, 2.5)
  scene.add(hemisphere, key, rim, fill)

  scene.add(shared.blobGroup)

  const ground = new THREE.Mesh(shared.groundGeometry, shared.shadowMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  ground.receiveShadow = true
  scene.add(ground)

  shared.blobGroup.children[0].castShadow = true

  const setParams = (next: DotSurfaceParams) => {
    shared.material.color.copy(hexToLinear(next.color))
    shared.material.roughness = dotSoftnessPresets[next.softness ?? defaultDotSoftness].roughness
    shared.uniforms.uAmp.value = next.wobble
    shared.uniforms.uSeed.value = next.seed
    shared.uniforms.uSSSColor.value.copy(hexToLinear(next.sssColor))
    shared.uniforms.uSSSStrength.value = next.sssStrength
    shared.leftEye.position.set(-0.38 + next.eyeOffsetX, 0.18 + next.eyeOffsetY, 0.9)
    shared.rightEye.position.set(0.38 + next.eyeOffsetX, 0.18 + next.eyeOffsetY, 0.9)
  }
  setParams(params)

  const clock = new THREE.Clock()
  const update = () => {
    const delta = clock.getDelta()
    const elapsed = clock.elapsedTime
    shared.uniforms.uTime.value = elapsed
    const s = Math.sin(elapsed * 1.4)
    shared.blobGroup.scale.set(1 - s * 0.02, 1 + s * 0.035, 1 - s * 0.02)
    shared.blobGroup.rotation.y = Math.sin(elapsed * 0.3) * 0.12
    shared.leftEye.lookAt(camera.position)
    shared.rightEye.lookAt(camera.position)
  }

  const render = (renderer: THREE.WebGLRenderer) => {
    renderer.render(scene, camera)
  }

  const resize = (width: number, height: number) => {
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const dispose = () => {
    scene.remove(shared.blobGroup, ground, hemisphere, key, rim, fill)
  }

  return { scene, camera, render, update, setParams, resize, dispose }
}

export const prefersReducedSegments = () =>
  typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
