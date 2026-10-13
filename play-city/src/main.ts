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
import { mountGarage } from './garage'
import { Bullets } from './combat/Bullets'
import { Presence } from './net/Presence'
import { RemoteCars } from './net/RemoteCars'
import { FIRE_RATE, MAX_HP, SPAWN_PROTECT_S, otherVehicle, type VehicleKind } from './net/protocol'

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!

// Everything below depends on who you are, so the garage runs first. The
// promise resolves when the player picks a ride (or skips) — until then the
// scene stays a frozen backdrop behind the overlay.
const profile = await mountGarage()

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(PALETTE.sky)
scene.fog = new THREE.Fog(PALETTE.fog, 900, 2500)

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 6400)
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
sun.shadow.camera.far = 1300
sun.shadow.camera.left = -280
sun.shadow.camera.right = 280
sun.shadow.camera.top = 280
sun.shadow.camera.bottom = -280
sun.shadow.bias = -0.0008
scene.add(sun)
scene.add(sun.target)

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x86a06a, 1.35))

// Identity comes from the garage (name, ride, paint) and is settled before the
// first network packet, so the car is painted correctly on frame one and the
// tab can be reloaded without changing either.
const presence = new Presence(profile)
const remoteCars = new RemoteCars()
scene.add(remoteCars.group)

let kind: VehicleKind = presence.kind
let vehicle: Vehicle = createVehicle(kind, presence.color)
scene.add(vehicle.group)
scene.add(remoteCars.nameTags.group)

/** Physics+pose owner for the current vehicle; rebuilt on mount and respawn. */
let controller = new CarController(vehicle, presence.spawn, profileFor(kind))

const chase = new ChaseCamera(camera)
const input = new Input(canvas)
const hud = new Hud(layout)
hud.setVehicle(vehicleLabel(kind))
hud.setHealth(presence.hp, MAX_HP)

// Combat. Bullets live in the city like everything else; the respawn timer
// gates driving, shooting, and pose announcements while a wreck is on screen.
const bullets = new Bullets()
scene.add(bullets.group)
const targetColliders = remoteCars.colliders
const muzzle = new THREE.Vector3()
const ROF_MS = 1000 / FIRE_RATE
let lastFireAt = Number.NEGATIVE_INFINITY
let respawnAt = 0
let kills = 0

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

/**
 * Wreck flow: stop the car, show who did it, respawn on a fresh patch of road
 * when the countdown ends. The very next announce POST tells the relay we are
 * back, which refills everybody's copy of our health bar.
 */
presence.onWrecked = (by) => {
  respawnAt = performance.now() + SPAWN_PROTECT_S * 1000
  const killer = presence.players.get(by)
  hud.showWrecked(killer?.name ?? '')
  // Our own wreck arrives here, not through onHit — still deserves the blast.
  bullets.blast(controller.position.x, controller.position.z)
}

presence.onShot = (shot) => {
  bullets.spawn(shot.x, shot.z, shot.h, false)
  remoteCars.flashAt(shot.by)
}

presence.onHit = (feedback) => {
  // We learn our own hp through the same broadcast that tells everyone else.
  if (feedback.onMe && !feedback.wrecked) hud.damageFlash()
  if (feedback.byMe && feedback.wrecked) kills += 1
  // A wreck goes out with a bang: big blast where the victim was. Our own car
  // is not in the roster, so a wreck with us as the target uses our position.
  if (feedback.wrecked) {
    const victim = presence.players.get(feedback.target)
    if (victim) bullets.blast(victim.x, victim.z)
    else bullets.blast(controller.position.x, controller.position.z)
  }
}

/** Back on the road: fresh spawn, full tank, gone overlay. */
function respawn() {
  const at = presence.respawn()
  controller = new CarController(vehicle, at, profileFor(kind))
  hud.hideWrecked()
  hud.setHealth(presence.hp, MAX_HP)
}

/** Multiplayer is a bonus, never a dependency: a missing server must never break the game. */
function net(action: () => void) {
  try {
    action()
  } catch (error) {
    console.warn('multiplayer hiccup', error)
  }
}

const clock = new THREE.Clock()
const sunOffset = new THREE.Vector3(280, 440, 200)

function resize() {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}
window.addEventListener('resize', resize)

function frame() {
  const dt = clock.getDelta()
  const dead = presence.dead

  const state = input.poll()
  // Remote cars first, so their colliders are current for this frame's physics.
  net(() => remoteCars.sync(presence.players, camera))
  net(() => remoteCars.update(dt, camera))

  // Trigger. The relay relays; bullets here are the visual truth, and only
  // `mine` bullets report hits the server will honour.
  if (state.fire && !dead && performance.now() - lastFireAt >= ROF_MS) {
    lastFireAt = performance.now()
    vehicle.gun.muzzle(muzzle)
    bullets.spawn(muzzle.x, muzzle.z, controller.heading, true)
    vehicle.gun.flashMuzzle()
    net(() => presence.fire(muzzle.x, muzzle.z, controller.heading))
  }

  if (!dead) {
    controller.update(dt, state, layout.colliders, [
      ...staticCircles,
      ...traffic.colliders,
      ...targetColliders,
    ])
  }

  traffic.update(dt, controller.position.x, controller.position.z, controller.speed)
  breakables.update(dt)
  vehicle.gun.update(dt)

  const bulletHits = bullets.update(
    dt,
    layout.colliders,
    [...staticCircles, ...traffic.colliders],
    targetColliders,
    dead ? null : { x: controller.position.x, z: controller.position.z, r: 1.7 },
  )
  for (const hit of bulletHits) {
    if (!hit.mine) continue
    if (hit.remoteId) presence.claimHit(hit.remoteId, 10)
    if (hit.breakable !== null) {
      const spec = layout.breakables[hit.breakable]
      // Bullet shove, x4 for the x4 city so debris flies like it used to.
      if (spec) breakables.break(spec, hit.x, hit.z, Math.sin(hit.h) * 24, Math.cos(hit.h) * 24)
    }
    if (hit.trafficIndex !== null) traffic.knock(hit.trafficIndex, Math.sin(hit.h) * 24, Math.cos(hit.h) * 24)
  }

  if (!dead) {
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
  }

  if (dead && performance.now() >= respawnAt) respawn()

  if (input.consumeCameraToggle()) chase.cycleMode()
  if (input.consumeHelpToggle()) hud.toggleHint()
  if (input.consumeVehicleToggle() && !dead) mountVehicle(otherVehicle(kind))

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
  hud.setHealth(presence.hp, MAX_HP)
  hud.setKills(kills)
  net(() => presence.announce(controller.telemetry))
  net(() => hud.setNet(presence.status, presence.players.size))

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

resize()
frame()
