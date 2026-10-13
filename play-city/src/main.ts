import * as THREE from 'three'
import { PALETTE } from './city/materials'
import { CountryWorld } from './world/CountryWorld'
import { CarController } from './car/CarController'
import { createVehicle, profileFor, vehicleLabel, type Vehicle } from './car/vehicle'
import { ChaseCamera } from './ChaseCamera'
import { Hud } from './Hud'
import { Input } from './Input'
import { mountGarage } from './garage'
import { Bullets } from './combat/Bullets'
import { Speedlines } from './fx/Speedlines'
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
scene.fog = new THREE.Fog(PALETTE.fog, 220, 620)

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.5, 1600)
camera.position.set(0, 12, 80)

const world = new CountryWorld()
scene.add(world.group)

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshLambertMaterial({ color: 0x7fc46b }),
)
ground.rotation.x = -Math.PI / 2
// Distant skirt below the lowest hollow so no gaps show past the tiles.
ground.position.set(0, -8, 0)
ground.receiveShadow = true
scene.add(ground)

// Drifting cloud puffs: 12 clusters of squashed icosahedrons scattered over a
// 1200x1200 area that follows the car, wrapping so they never run out.
const CLOUD_SPAN = 1200
const cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff })
interface CloudPuff {
  group: THREE.Group
  baseX: number
  baseZ: number
}
const cloudPuffs: CloudPuff[] = []
for (let i = 0; i < 12; i++) {
  const puff = new THREE.Group()
  const lumps = 2 + Math.floor(Math.random() * 2)
  for (let k = 0; k < lumps; k++) {
    const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + Math.random() * 5, 0), cloudMaterial)
    lump.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8)
    lump.scale.y = 0.55
    puff.add(lump)
  }
  puff.position.y = 55 + Math.random() * 20
  scene.add(puff)
  cloudPuffs.push({
    group: puff,
    baseX: (Math.random() - 0.5) * CLOUD_SPAN,
    baseZ: (Math.random() - 0.5) * CLOUD_SPAN,
  })
}
let cloudDrift = 0
const wrapCloud = (v: number): number =>
  ((((v + CLOUD_SPAN / 2) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - CLOUD_SPAN / 2

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
const hud = new Hud()
const speedlines = new Speedlines()
hud.setVehicle(vehicleLabel(kind))
hud.setHealth(presence.hp, MAX_HP)

// Combat. Bullets live in the world like everything else; the respawn timer
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
  bullets.blast(controller.position.x, controller.position.z, controller.airY + 1.2)
}

presence.onShot = (shot) => {
  bullets.spawn(shot.x, shot.z, shot.h, false, world.heightAt(shot.x, shot.z) + 1.25)
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
    if (victim) bullets.blast(victim.x, victim.z, world.heightAt(victim.x, victim.z) + 1.2)
    else bullets.blast(controller.position.x, controller.position.z, controller.airY + 1.2)
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
const sunOffset = new THREE.Vector3(70, 110, 50)
// Scratch target so the chase camera follows the car's terrain height
// (controller.position itself stays at y=0; height lives in airY).
const camTarget = new THREE.Vector3()

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
    bullets.spawn(muzzle.x, muzzle.z, controller.heading, true, muzzle.y)
    vehicle.gun.flashMuzzle()
    net(() => presence.fire(muzzle.x, muzzle.z, controller.heading))
  }

  world.ensure(controller.position.x, controller.position.z)
  world.update(dt)
  const boxes = world.boxes
  const circles = world.circles

  if (!dead) {
    // Ride the terrain: ground level first, then ramps add their wedge on top
    // (ramp meshes sit on the terrain, so physics must too).
    const tY = world.heightAt(controller.position.x, controller.position.z)
    controller.groundY = tY
    for (const ramp of world.ramps) {
      const along =
        ramp.axis === 'x' ? controller.position.x - ramp.x : controller.position.z - ramp.z
      const across =
        ramp.axis === 'x' ? controller.position.z - ramp.z : controller.position.x - ramp.x
      if (Math.abs(across) > 3.5) continue
      const signed = along * ramp.dir
      // ~1m past the lip stays "on ramp" so a fast frame step still lands on
      // progress >= 1 instead of tunnelling from ramp to dirt between frames.
      if (signed < -5.5 || signed > 6.5) continue
      // Only when travelling the intended way up the wedge.
      const f =
        ramp.axis === 'x' ? Math.sin(controller.heading) : Math.cos(controller.heading)
      if (Math.sign(f) !== ramp.dir) continue
      const progress = (signed + 5.5) / 11
      const height = 2.4 * Math.min(1, Math.max(0, progress))
      controller.groundY = Math.max(controller.groundY, tY + height)
      if (progress >= 1 && !controller.isAirborne && Math.abs(controller.speed) > 4) {
        controller.launch(Math.min(26, Math.max(9, controller.speed * 0.5)))
      }
    }
    controller.update(dt, state, boxes, [...circles, ...targetColliders])

    // Tilt the body to match the hillside. Pitch positive = nose down, roll
    // positive = right side up; both zeroed while airborne.
    if (controller.isAirborne) {
      controller.slopePitch = 0
      controller.slopeRoll = 0
    } else {
      const h = controller.heading
      const fx = Math.sin(h)
      const fz = Math.cos(h)
      const hF = world.heightAt(
        controller.position.x + fx * 2.2,
        controller.position.z + fz * 2.2,
      )
      const hB = world.heightAt(
        controller.position.x - fx * 2.2,
        controller.position.z - fz * 2.2,
      )
      const rx = Math.cos(h)
      const rz = -Math.sin(h)
      const hR = world.heightAt(
        controller.position.x + rx * 1.4,
        controller.position.z + rz * 1.4,
      )
      const hL = world.heightAt(
        controller.position.x - rx * 1.4,
        controller.position.z - rz * 1.4,
      )
      controller.slopePitch = -Math.atan2(hF - hB, 4.4)
      controller.slopeRoll = Math.atan2(hR - hL, 2.8)
    }
  }

  speedlines.draw(dead ? 0 : controller.kmh)

  vehicle.gun.update(dt)

  const bulletHits = bullets.update(
    dt,
    boxes,
    circles,
    targetColliders,
    dead ? null : { x: controller.position.x, z: controller.position.z, r: 1.7 },
  )
  for (const hit of bulletHits) {
    if (!hit.mine) continue
    if (hit.remoteId) presence.claimHit(hit.remoteId, 10)
  }

  if (dead && performance.now() >= respawnAt) respawn()

  if (input.consumeCameraToggle()) chase.cycleMode()
  if (input.consumeHelpToggle()) hud.toggleHint()
  if (input.consumeVehicleToggle() && !dead) mountVehicle(otherVehicle(kind))

  camTarget.set(controller.position.x, controller.airY, controller.position.z)
  chase.update(
    dt,
    camTarget,
    controller.heading,
    controller.speed,
    input.consumeDrag(),
    input.consumeZoom(),
  )

  sun.position.copy(controller.position).add(sunOffset)
  sun.target.position.copy(controller.position)
  sun.target.updateMatrixWorld()

  ground.position.x = controller.position.x
  ground.position.z = controller.position.z

  // Clouds drift +x and wrap around the car in a 1200-wide window.
  cloudDrift += 2.5 * dt
  for (const puff of cloudPuffs) {
    puff.group.position.x = controller.position.x + wrapCloud(puff.baseX + cloudDrift)
    puff.group.position.z = controller.position.z + wrapCloud(puff.baseZ)
  }

  hud.update(
    controller.kmh,
    controller.gear,
    controller.position,
    controller.heading,
    0,
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
