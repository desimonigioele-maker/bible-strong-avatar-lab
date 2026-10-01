import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import {
  defaultDotSoftness,
  dotSoftnessPresets,
  type DotSurfaceParams,
} from '@bible-strong/avatar-core'

import { defaultDotParams, prefersReducedSegments } from '../dotEngine'
import {
  DISPLACEMENT_FIELD_GLSL,
  SIMPLEX_NOISE_GLSL,
  SSS_PATCH_GLSL,
  VERTEX_PATCH_GLSL,
} from '../dotShaders'

const CAMERA_POSITION: [number, number, number] = [0, 0.35, 5.2]

const hexToLinear = (hex: string) => new THREE.Color(hex).convertSRGBToLinear()

type BlobUniforms = {
  uTime: { value: number }
  uAmp: { value: number }
  uFreq: { value: number }
  uSeed: { value: number }
  uSSSColor: { value: THREE.Color }
  uSSSStrength: { value: number }
}

/** Module-level singleton: one geometry per segment count for the whole app. */
const geometryCache = new Map<number, THREE.SphereGeometry>()
const getBlobGeometry = (nSegments: number) => {
  let geometry = geometryCache.get(nSegments)
  if (!geometry) {
    geometry = new THREE.SphereGeometry(1, nSegments, nSegments)
    geometryCache.set(nSegments, geometry)
  }
  return geometry
}

const applyParamsToMaterial = (
  material: THREE.MeshPhysicalMaterial,
  uniforms: BlobUniforms,
  params: DotSurfaceParams
) => {
  material.color.copy(hexToLinear(params.color))
  material.roughness = dotSoftnessPresets[params.softness ?? defaultDotSoftness].roughness
  uniforms.uAmp.value = params.wobble
  uniforms.uSeed.value = params.seed
  uniforms.uSSSColor.value.copy(hexToLinear(params.sssColor))
  uniforms.uSSSStrength.value = params.sssStrength
}

const Blob = ({ params, nSegments }: { params: DotSurfaceParams; nSegments: number }) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const leftEyeRef = useRef<THREE.Group>(null)
  const rightEyeRef = useRef<THREE.Group>(null)
  const { camera } = useThree()

  const [resources] = useState(() => {
    const geometry = getBlobGeometry(nSegments)
    const uniforms: BlobUniforms = {
      uTime: { value: 0 },
      uAmp: { value: params.wobble },
      uFreq: { value: 1.6 },
      uSeed: { value: params.seed },
      uSSSColor: { value: hexToLinear(params.sssColor) },
      uSSSStrength: { value: params.sssStrength },
    }
    const material = new THREE.MeshPhysicalMaterial({
      color: hexToLinear(params.color),
      roughness: dotSoftnessPresets[params.softness ?? defaultDotSoftness].roughness,
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
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed = wobbleDisplaced;'
        )
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

    const eyeGeometry = new THREE.SphereGeometry(0.115, 32, 32)
    const catchlightGeometry = new THREE.SphereGeometry(0.05, 16, 16)
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
    return {
      geometry,
      uniforms,
      material,
      eyeGeometry,
      catchlightGeometry,
      eyeMaterial,
      catchlightMaterial,
    }
  })

  useEffect(() => {
    applyParamsToMaterial(resources.material, resources.uniforms, params)
  }, [params, resources])

  useEffect(
    () => () => {
      resources.material.dispose()
      resources.eyeMaterial.dispose()
      resources.catchlightMaterial.dispose()
    },
    [resources]
  )

  useFrame((_, delta) => {
    const blob = meshRef.current
    if (!blob) return
    resources.uniforms.uTime.value += delta
    const t = resources.uniforms.uTime.value
    const s = Math.sin(t * 1.4)
    blob.scale.set(1 - s * 0.02, 1 + s * 0.035, 1 - s * 0.02)
    blob.rotation.y = Math.sin(t * 0.3) * 0.12
    leftEyeRef.current?.lookAt(camera.position)
    rightEyeRef.current?.lookAt(camera.position)
  })

  const eyePosition = (side: -1 | 1): [number, number, number] => [
    side * 0.38 + params.eyeOffsetX,
    0.18 + params.eyeOffsetY,
    0.9,
  ]

  return (
    <mesh ref={meshRef} geometry={resources.geometry} material={resources.material} castShadow>
      <group ref={leftEyeRef} position={eyePosition(-1)}>
        <mesh
          geometry={resources.eyeGeometry}
          material={resources.eyeMaterial}
          scale={[1, 1.25, 0.55]}
        />
        <mesh
          geometry={resources.catchlightGeometry}
          material={resources.catchlightMaterial}
          position={[0.06, 0.09, 0.13]}
        />
      </group>
      <group ref={rightEyeRef} position={eyePosition(1)}>
        <mesh
          geometry={resources.eyeGeometry}
          material={resources.eyeMaterial}
          scale={[1, 1.25, 0.55]}
        />
        <mesh
          geometry={resources.catchlightGeometry}
          material={resources.catchlightMaterial}
          position={[0.06, 0.09, 0.13]}
        />
      </group>
    </mesh>
  )
}

const Lights = () => (
  <>
    <hemisphereLight intensity={0.42} color={0xffffff} groundColor={0x334455} />
    <directionalLight
      position={[2.5, 3.5, 2.5]}
      intensity={1.9}
      color={0xfff2e0}
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-radius={8}
      shadow-camera-near={1}
      shadow-camera-far={12}
      shadow-camera-left={-3}
      shadow-camera-right={3}
      shadow-camera-top={3}
      shadow-camera-bottom={-3}
    />
    <directionalLight position={[-2.5, 1.5, -2.5]} intensity={2.1} color={0xff4fd8} />
    <directionalLight position={[-3, 0.5, 2.5]} intensity={0.6} color={0x7ab8ff} />
  </>
)

const Ground = () => (
  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.42, 0]} receiveShadow>
    <circleGeometry args={[3, 48]} />
    <shadowMaterial opacity={0.35} />
  </mesh>
)

const EnvironmentLighting = () => {
  const { scene, gl } = useThree()
  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    void import('three/examples/jsm/environments/RoomEnvironment.js').then(
      ({ RoomEnvironment }) => {
        if (disposed) return
        const environment = new RoomEnvironment()
        const pmrem = new THREE.PMREMGenerator(gl)
        const texture = pmrem.fromScene(environment, 0.04).texture
        scene.environment = texture
        cleanup = () => {
          scene.environment = null
          texture.dispose()
          pmrem.dispose()
        }
      }
    )
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [gl, scene])
  return null
}

export function DotBody({
  params = defaultDotParams,
  className,
}: {
  params?: DotSurfaceParams
  className?: string
}) {
  const [nSegments] = useState(() => (prefersReducedSegments() ? 64 : 128))
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        shadows
        flat={false}
        camera={{ position: CAMERA_POSITION, fov: 35 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.05
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <EnvironmentLighting />
        <Lights />
        <Blob params={params} nSegments={nSegments} />
        <Ground />
      </Canvas>
    </div>
  )
}
