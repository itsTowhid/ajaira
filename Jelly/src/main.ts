import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './style.css'
import { clamp } from './util'
import { World } from './world'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const piecesOut = document.querySelector<HTMLElement>('#pieces')!
const cutsOut = document.querySelector<HTMLElement>('#cuts')!
const piecesLabel = document.querySelector<HTMLElement>('#pieces-label')!
const cutsLabel = document.querySelector<HTMLElement>('#cuts-label')!
const hint = document.querySelector<HTMLElement>('#hint')!
const wobbleButton = document.querySelector<HTMLButtonElement>('#btn-wobble')!
const resetButton = document.querySelector<HTMLButtonElement>('#btn-reset')!

const BACKGROUND = 0x140d13
const DRAG_SLOP = 5

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(BACKGROUND)
scene.fog = new THREE.Fog(BACKGROUND, 9, 22)

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120)
camera.position.set(0, 7.6, 9.2)

const controls = new OrbitControls(camera, canvas)
controls.target.set(0, 0.3, 0)
controls.enableDamping = true
controls.dampingFactor = 0.075
controls.enablePan = false
controls.minDistance = 4
controls.maxDistance = 20
controls.minPolarAngle = 0.25
controls.maxPolarAngle = 1.43

const key = new THREE.DirectionalLight(0xfff2e2, 2.6)
key.position.set(6, 11, 7)
key.castShadow = true
key.shadow.mapSize.set(2048, 2048)
key.shadow.camera.near = 1
key.shadow.camera.far = 40
key.shadow.camera.left = -8
key.shadow.camera.right = 8
key.shadow.camera.top = 8
key.shadow.camera.bottom = -8
key.shadow.bias = -0.0002
key.shadow.normalBias = 0.02
scene.add(key)

const rim = new THREE.DirectionalLight(0x8ce8ff, 1.1)
rim.position.set(-6, 4, -5)
scene.add(rim)

scene.add(new THREE.HemisphereLight(0xffe4f0, 0x1a0d14, 0.7))

const plate = new THREE.Mesh(
  new THREE.CircleGeometry(24, 64),
  new THREE.MeshStandardMaterial({ color: 0x2b1e29, roughness: 0.6, metalness: 0.15 }),
)
plate.rotation.x = -Math.PI / 2
plate.receiveShadow = true
scene.add(plate)

function glowTexture(): THREE.CanvasTexture {
  const size = 256
  const source = document.createElement('canvas')
  source.width = size
  source.height = size
  const context = source.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,158,186,0.5)')
  gradient.addColorStop(0.45, 'rgba(255,96,150,0.16)')
  gradient.addColorStop(1, 'rgba(255,60,120,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(source)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const glow = new THREE.Mesh(
  new THREE.PlaneGeometry(17, 17),
  new THREE.MeshBasicMaterial({
    map: glowTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
)
glow.rotation.x = -Math.PI / 2
glow.position.set(0, 0.004, 0)
scene.add(glow)

const world = new World()
scene.add(world.group)

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()

function setPointer(event: PointerEvent): void {
  pointer.set(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
}

let tracking = false
let grabbed = false
let moved = false
let downX = 0
let downY = 0
let downTime = 0
let lastMoveTime = 0

function pointerMoved(event: PointerEvent): boolean {
  return Math.hypot(event.clientX - downX, event.clientY - downY) > DRAG_SLOP
}

window.addEventListener(
  'pointerdown',
  (event) => {
    if (event.button !== 0) return
    setPointer(event)
    tracking = true
    moved = false
    downX = event.clientX
    downY = event.clientY
    downTime = performance.now()
    lastMoveTime = downTime
    grabbed = world.beginDrag(raycaster)

    if (grabbed) {
      canvas.style.cursor = 'grabbing'
      event.stopPropagation()
      event.preventDefault()
    }
  },
  { capture: true, passive: false },
)

window.addEventListener('pointermove', (event) => {
  const now = performance.now()
  if (tracking && !moved && pointerMoved(event)) moved = true

  if (grabbed) {
    setPointer(event)
    const dt = clamp((now - lastMoveTime) / 1000, 1 / 240, 0.05)
    lastMoveTime = now
    if (moved) world.dragTo(raycaster, dt)
    return
  }

  setPointer(event)
  canvas.style.cursor = world.hitTest(raycaster) ? 'grab' : 'default'
})

window.addEventListener('pointerup', (event) => {
  if (!tracking || event.button !== 0) return
  const wasGrabbed = grabbed
  const wasMoved = moved
  const duration = performance.now() - downTime

  tracking = false
  grabbed = false
  moved = false
  setPointer(event)
  canvas.style.cursor = world.hitTest(raycaster) ? 'grab' : 'default'

  if (wasGrabbed) {
    world.endDrag()
    if (wasMoved || duration > 450) return
  } else if (wasMoved || duration > 450) {
    return
  }

  const result = world.handlePointer(raycaster)
  if (result !== 'miss') hint.classList.add('hint--hidden')
  syncHud()
})

window.addEventListener('pointercancel', () => {
  if (grabbed) world.endDrag()
  tracking = false
  grabbed = false
  moved = false
  canvas.style.cursor = 'default'
})

canvas.addEventListener('pointerleave', () => {
  if (!grabbed) canvas.style.cursor = 'default'
})

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault()
    world.wobble()
  } else if (event.code === 'KeyR') {
    reset()
  }
})

wobbleButton.addEventListener('click', () => world.wobble())
resetButton.addEventListener('click', () => reset())

function reset(): void {
  world.reset()
  syncHud()
}

let shownPieces = -1
let shownCuts = -1

function syncHud(): void {
  if (world.pieceCount !== shownPieces) {
    shownPieces = world.pieceCount
    piecesOut.textContent = String(shownPieces)
    piecesLabel.textContent = shownPieces === 1 ? 'piece' : 'pieces'
  }
  if (world.cutCount !== shownCuts) {
    shownCuts = world.cutCount
    cutsOut.textContent = String(shownCuts)
    cutsLabel.textContent = shownCuts === 1 ? 'cut' : 'cuts'
  }
}

function resize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

window.addEventListener('resize', resize)

const clock = new THREE.Clock()

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05)
  controls.update()
  world.update(dt)
  renderer.render(scene, camera)
}

canvas.style.cursor = 'default'
syncHud()
resize()
renderer.setAnimationLoop(frame)
