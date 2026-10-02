import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

import { buildGalaxyGeometry, buildStarfieldGeometry } from './galaxy'
import { createParticleMaterial } from './particleMaterial'
import { MouseNavigator } from './controls'

const PARTICLE_COUNT = 300_000

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const statsEl = document.querySelector<HTMLSpanElement>('#stats')!

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x02030a)

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000)
camera.position.set(0, 85, 150)

const galaxyGroup = new THREE.Group()
galaxyGroup.rotation.x = 0.18
scene.add(galaxyGroup)

const galaxyGeometry = buildGalaxyGeometry({ count: PARTICLE_COUNT, radius: 70, arms: 4 })
const galaxyMaterial = createParticleMaterial(120)
galaxyMaterial.uniforms.uIntensity.value = 1.05
const galaxy = new THREE.Points(galaxyGeometry, galaxyMaterial)
galaxy.frustumCulled = false
galaxyGroup.add(galaxy)

const starfield = new THREE.Points(buildStarfieldGeometry(7000, 1100), createParticleMaterial(60))
starfield.frustumCulled = false
scene.add(starfield)

const starfieldMaterial = starfield.material as THREE.ShaderMaterial
starfieldMaterial.uniforms.uIntensity.value = 0.55
starfieldMaterial.uniforms.uTwinkle.value = 0.5

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85,
  0.6,
  0.2,
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

const navigator = new MouseNavigator(camera, new THREE.Vector3(0, 0, 0), canvas, {
  yawSpeed: 0.85,
  pitchSpeed: 0.5,
})

const clock = new THREE.Clock()
let frames = 0
let statTimer = 0
let fps = 0

function resize() {
  const width = window.innerWidth
  const height = window.innerHeight
  const pixelRatio = Math.min(window.devicePixelRatio, 2)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(width, height)
  composer.setPixelRatio(pixelRatio)
  composer.setSize(width, height)
  bloom.setSize(width, height)
  galaxyMaterial.uniforms.uPixelRatio.value = pixelRatio
  starfieldMaterial.uniforms.uPixelRatio.value = pixelRatio
}
window.addEventListener('resize', resize)

function frame() {
  const dt = clock.getDelta()
  const elapsed = clock.elapsedTime

  navigator.update(dt)

  galaxyMaterial.uniforms.uTime.value = elapsed
  starfieldMaterial.uniforms.uTime.value = elapsed

  galaxy.rotation.y = elapsed * 0.008

  composer.render()

  frames++
  statTimer += dt
  if (statTimer >= 0.5) {
    fps = Math.round(frames / statTimer)
    frames = 0
    statTimer = 0
    statsEl.textContent = `${(PARTICLE_COUNT / 1000).toFixed(0)}k particles · ${fps} fps · ${camera.position.length().toFixed(0)} units`
  }

  requestAnimationFrame(frame)
}

resize()
frame()
