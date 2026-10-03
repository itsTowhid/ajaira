import * as THREE from 'three'
import { Breakables } from './city/breakables'
import { buildCity } from './city/build'
import { generateCityLayout } from './city/layout'
import { Traffic } from './city/traffic'
import { PALETTE } from './city/materials'
import { CarController } from './car/CarController'
import { createVehicle, profileFor, vehicleLabel, type Vehicle } from './car/vehicle'
import { ChaseCamera } from './ChaseCamera'
import { Hud } from './Hud'
import { Input } from './Input'
import { Presence } from './net/Presence'
import { RemoteCars } from './net/RemoteCars'
import { otherVehicle, type VehicleKind } from './net/protocol'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(PALETTE.sky)
scene.fog = new THREE.Fog(PALETTE.fog, 220, 620)

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 1600)
camera.position.set(0, 12, 80)

const layout = generateCityLayout()
scene.add(buildCity(layout))

const breakables = new Breakables(layout)
scene.add(breakables.group)

const traffic = new Traffic()
scene.add(traffic.group)
const staticCircles = [...layout.circles]

const sun = new THREE.DirectionalLight(0xfff2d6, 2.5)
sun.position.set(60, 90, 40)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.near = 1
sun.shadow.camera.far = 320
sun.shadow.camera.left = -70
sun.shadow.camera.right = 70
sun.shadow.camera.top = 70
sun.shadow.camera.bottom = -70
sun.shadow.bias = -0.0008
scene.add(sun)
scene.add(sun.target)

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x86a06a, 1.35))

// Identity and spawn are ours, so the car is painted correctly on frame one and
// the tab can be reloaded without changing colour.
const presence = new Presence()
const remoteCars = new RemoteCars()
scene.add(remoteCars.group)

let kind: VehicleKind = presence.kind
let vehicle: Vehicle = createVehicle(kind, presence.color)
scene.add(vehicle.group)
let controller = new CarController(vehicle, presence.spawn, profileFor(kind))

const chase = new ChaseCamera(camera)
const input = new Input(canvas)
const hud = new Hud(layout)
hud.setVehicle(vehicleLabel(kind))

/**
 * Swap rides on the spot. The pose carries over so you do not teleport, but
 * momentum does not: the new vehicle starts from a standstill.
 */
function mountVehicle(next: VehicleKind) {
  if (next === kind) return
  const at = { x: controller.position.x, z: controller.position.z, heading: controller.heading }
  vehicle.dispose()
  vehicle = createVehicle(next, presence.color)
  scene.add(vehicle.group)
  controller = new CarController(vehicle, at, profileFor(next))
  kind = next
  presence.setKind(next)
  hud.setVehicle(vehicleLabel(next))
}

const clock = new THREE.Clock()
const sunOffset = new THREE.Vector3(70, 110, 50)

function resize() {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}
window.addEventListener('resize', resize)

/** Multiplayer is a bonus, never a dependency: a missing server must never break the game. */
function net(action: () => void) {
  try {
    action()
  } catch (error) {
    console.warn('multiplayer hiccup', error)
  }
}

function frame() {
  const dt = clock.getDelta()

  const state = input.poll()
  // Remote cars first, so their colliders are current for this frame's physics.
  net(() => remoteCars.sync(presence.players, camera))
  net(() => remoteCars.update(dt, camera))
  controller.update(dt, state, layout.colliders, [
    ...staticCircles,
    ...traffic.colliders,
    ...remoteCars.colliders,
  ])

  traffic.update(dt, controller.position.x, controller.position.z, controller.speed)
  breakables.update(dt)

  if (controller.breakableHits.size > 0) {
    const pushX = Math.sin(controller.heading) * controller.speed * 0.45
    const pushZ = Math.cos(controller.heading) * controller.speed * 0.45
    for (const id of controller.breakableHits) {
      const spec = layout.breakables[id]
      if (spec) breakables.break(spec, controller.position.x, controller.position.z, pushX, pushZ)
    }
  }

  for (const index of controller.trafficHits) {
    traffic.knock(
      index,
      Math.sin(controller.heading) * controller.speed * 0.7,
      Math.cos(controller.heading) * controller.speed * 0.7,
    )
  }

  if (input.consumeCameraToggle()) chase.cycleMode()
  if (input.consumeHelpToggle()) hud.toggleHint()
  if (input.consumeVehicleToggle()) mountVehicle(otherVehicle(kind))

  chase.update(
    dt,
    controller.position,
    controller.heading,
    controller.speed,
    input.consumeDrag(),
    input.consumeZoom(),
  )

  sun.position.copy(controller.position).add(sunOffset)
  sun.target.position.copy(controller.position)
  sun.target.updateMatrixWorld()

  hud.update(
    controller.kmh,
    controller.gear,
    controller.position,
    controller.heading,
    breakables.smashed,
    remoteCars.blips,
  )
  net(() => presence.announce(controller.telemetry))
  net(() => hud.setNet(presence.status, presence.players.size))

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

resize()
frame()
