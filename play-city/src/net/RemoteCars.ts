import * as THREE from 'three'
import {
  POSE_RATE,
  steerLimitFor,
  type VehicleProfile,
} from '../car/tuning'
import { createVehicle, profileFor, type Vehicle } from '../car/vehicle'
import { CULL_DISTANCE, INTERP_DELAY_MS, MAX_EXTRAPOLATE_MS, MAX_REMOTE_CARS } from './protocol'
import { NameTags } from './NameTags'
import type { RemoteState } from './Presence'
import type { VehicleKind } from './protocol'
import type { CircleCollider } from '../city/layout'

/** Two seconds of history at 12 Hz. */
const RING_SIZE = 24
/** Below this, inverting yaw rate to a steer angle is meaningless. */
const MIN_SPEED_FOR_STEER = 1.5
const TAU = Math.PI * 2

interface Snapshot {
  /** `performance.now()` when it arrived — see INTERP_DELAY_MS. */
  at: number
  x: number
  z: number
  h: number
  s: number
}

interface Sample {
  x: number
  z: number
  h: number
  s: number
  /** Rad/s between the two bracketing snapshots, 0 when there is only one. */
  yawRate: number
  /** Units/s between the two bracketing snapshots. */
  accel: number
}

interface Remote {
  kind: VehicleKind
  profile: VehicleProfile
  vehicle: Vehicle
  ring: Snapshot[]
  /** Cosmetic state, integrated locally the way CarController integrates it. */
  wheel: number
  phase: number
  steer: number
  roll: number
  pitch: number
  collider: CircleCollider
  blip: { x: number; z: number; color: number }
  /** Latest pose, re-published for the name-tag layer each frame. */
  pose: { x: number; z: number; h: number }
}

const angleDiff = (to: number, from: number) => {
  let delta = to - from
  while (delta > Math.PI) delta -= TAU
  while (delta < -Math.PI) delta += TAU
  return delta
}

function dropFrom<T>(list: T[], item: T) {
  const index = list.indexOf(item)
  if (index >= 0) list.splice(index, 1)
}

/**
 * Looks up where a car was at `target` (in arrival-time ms). Renders 110 ms in
 * the past so there is always a pair of snapshots to interpolate between; only
 * when the target runs off the end does it extrapolate, and then only briefly.
 */
function sampleAt(ring: Snapshot[], target: number): Sample | null {
  const newest = ring[ring.length - 1]
  if (!newest) return null
  const oldest = ring[0]

  if (target <= oldest.at) {
    return { x: oldest.x, z: oldest.z, h: oldest.h, s: oldest.s, yawRate: 0, accel: 0 }
  }

  if (target >= newest.at) {
    const over = Math.min(target - newest.at, MAX_EXTRAPOLATE_MS) / 1000
    return {
      x: newest.x + Math.sin(newest.h) * newest.s * over,
      z: newest.z + Math.cos(newest.h) * newest.s * over,
      h: newest.h,
      s: newest.s,
      yawRate: 0,
      accel: 0,
    }
  }

  let older = newest
  let newer = newest
  for (let i = ring.length - 1; i > 0; i--) {
    if (ring[i - 1].at <= target) {
      older = ring[i - 1]
      newer = ring[i]
      break
    }
  }

  const span = newer.at - older.at
  const t = span > 0 ? THREE.MathUtils.clamp((target - older.at) / span, 0, 1) : 0
  const seconds = span / 1000
  return {
    x: older.x + (newer.x - older.x) * t,
    z: older.z + (newer.z - older.z) * t,
    h: older.h + angleDiff(newer.h, older.h) * t,
    s: older.s + (newer.s - older.s) * t,
    yawRate: seconds > 0 ? angleDiff(newer.h, older.h) / seconds : 0,
    accel: seconds > 0 ? (newer.s - older.s) / seconds : 0,
  }
}

/**
 * Visuals for everybody else's ride. Purely downstream of `Presence`: nobody
 * here simulates, so a remote vehicle is always a slightly late interpolation
 * of what its owner reported.
 */
export class RemoteCars {
  readonly group = new THREE.Group()
  /** Solid to the local car: no `breakable`, no `trafficIndex`. */
  readonly colliders: CircleCollider[] = []
  /** Minimap dots, one per rendered car. */
  readonly blips: { x: number; z: number; color: number }[] = []

  private remotes = new Map<string, Remote>()

  /**
   * Name tags live in their own layer so RemoteCars keeps doing one thing:
   * turning roster poses into solid, interpolated vehicles.
   */
  readonly nameTags = new NameTags()

  /**
   * Diffs the roster against what is on screen, so no join/leave bookkeeping is
   * needed. When the city is busier than `MAX_REMOTE_CARS` the nearest cars win.
   */
  sync(roster: ReadonlyMap<string, RemoteState>, camera: THREE.Camera) {
    let wanted: string[]
    if (roster.size <= MAX_REMOTE_CARS) {
      wanted = [...roster.keys()]
    } else {
      wanted = [...roster.values()]
        .map((state) => ({
          id: state.id,
          d:
            (state.x - camera.position.x) * (state.x - camera.position.x) +
            (state.z - camera.position.z) * (state.z - camera.position.z),
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_REMOTE_CARS)
        .map((entry) => entry.id)
    }

    for (const [id, remote] of this.remotes) {
      if (wanted.includes(id)) continue
      remote.vehicle.dispose()
      this.remotes.delete(id)
      // Prune here too, not only in update(): the local car must never bounce off
      // a car that has just left, whatever order the frame called us in.
      dropFrom(this.colliders, remote.collider)
      dropFrom(this.blips, remote.blip)
      this.nameTags.drop(id)
    }

    for (const id of wanted) {
      const state = roster.get(id)
      if (!state) continue
      const existing = this.remotes.get(id)
      if (!existing) {
        const remote = this.create(state)
        this.remotes.set(id, remote)
        this.group.add(remote.vehicle.group)
      } else if (existing.kind !== state.kind) {
        // Their player swapped vehicles. New mesh, same interpolation history, so
        // the change lands where the car already is instead of teleporting back.
        this.rebuild(existing, state)
      }
    }

    this.ingest(roster)
    // Tags track the roster (who has a name), not the render set, so a tag
    // already waits when a distant named driver comes into range.
    this.nameTags.sync(roster.values())
  }

  /**
   * Turns roster mutations into timestamped snapshots. The clock starts here on
   * arrival, which is what makes arrival-time interpolation clock-sync free.
   */
  private ingest(roster: ReadonlyMap<string, RemoteState>) {
    const now = performance.now()
    for (const [id, remote] of this.remotes) {
      const state = roster.get(id)
      if (!state) continue
      const latest = remote.ring[remote.ring.length - 1]
      if (latest.x === state.x && latest.z === state.z && latest.h === state.h && latest.s === state.s) {
        continue
      }
      remote.ring.push({ at: now, x: state.x, z: state.z, h: state.h, s: state.s })
      if (remote.ring.length > RING_SIZE) remote.ring.shift()
    }
  }

  update(dt: number, camera: THREE.Camera) {
    const now = performance.now()
    const target = now - INTERP_DELAY_MS
    this.colliders.length = 0
    this.blips.length = 0

    for (const [id, remote] of this.remotes.entries()) {
      const state = sampleAt(remote.ring, target)
      if (!state) continue

      const profile = remote.profile
      const speedRatio = Math.min(1, Math.abs(state.s) / profile.maxSpeed)
      // Invert CarController's heading integration, then apply the same speed
      // falloff, so a remote vehicle leans and turns exactly like a local one.
      const rawSteer = Math.atan(
        (state.yawRate * profile.turnDivisor) / Math.max(MIN_SPEED_FOR_STEER, Math.abs(state.s)),
      )
      const limit = steerLimitFor(speedRatio, profile)
      const targetSteer = THREE.MathUtils.clamp(rawSteer, -limit, limit)
      remote.steer += (targetSteer - remote.steer) * Math.min(1, profile.steerRate * dt)

      const targetRoll = remote.steer * speedRatio * profile.leanPerSteer
      const targetPitch = THREE.MathUtils.clamp(
        -state.accel * profile.pitchFromAccel,
        -profile.maxPitch,
        profile.maxPitch,
      )
      remote.roll += (targetRoll - remote.roll) * Math.min(1, POSE_RATE * dt)
      remote.pitch += (targetPitch - remote.pitch) * Math.min(1, POSE_RATE * dt)

      remote.phase += dt * (4 + speedRatio * 26)
      remote.wheel = (remote.wheel + (state.s * dt) / remote.vehicle.wheelRadius) % TAU

      remote.vehicle.setPose({
        x: state.x,
        z: state.z,
        heading: state.h,
        roll: remote.roll,
        pitch: remote.pitch,
        bobY: Math.sin(remote.phase) * profile.bobAmplitude * (0.3 + speedRatio),
        steer: remote.steer,
        wheel: remote.wheel,
      })

      remote.pose.x = state.x
      remote.pose.z = state.z
      remote.pose.h = state.h

      remote.collider.x = state.x
      remote.collider.z = state.z
      this.colliders.push(remote.collider)

      remote.blip.x = state.x
      remote.blip.z = state.z
      this.blips.push(remote.blip)

      if (remote.vehicle.group.visible) {
        this.nameTags.place(id, state.x, 0, state.z, camera)
      }

      const dx = state.x - camera.position.x
      const dz = state.z - camera.position.z
      // Each vehicle is a dozen-odd draw calls and is not instanced, so culling
      // the far ones is the whole ballgame.
      remote.vehicle.group.visible = dx * dx + dz * dz < CULL_DISTANCE * CULL_DISTANCE
    }
  }

  private create(state: RemoteState): Remote {
    const profile = profileFor(state.kind)
    const vehicle = createVehicle(state.kind, state.color)
    const snap: Snapshot = { at: performance.now(), x: state.x, z: state.z, h: state.h, s: state.s }
    return {
      kind: state.kind,
      profile,
      vehicle,
      ring: [snap],
      wheel: 0,
      phase: 0,
      steer: 0,
      roll: 0,
      pitch: 0,
      collider: { x: state.x, z: state.z, r: profile.colliderRadius },
      blip: { x: state.x, z: state.z, color: state.color },
      pose: { x: state.x, z: state.z, h: state.h },
    }
  }

  private rebuild(remote: Remote, state: RemoteState) {
    remote.vehicle.dispose()
    const profile = profileFor(state.kind)
    const vehicle = createVehicle(state.kind, state.color)
    this.group.add(vehicle.group)
    remote.kind = state.kind
    remote.profile = profile
    remote.vehicle = vehicle
    remote.collider.r = profile.colliderRadius
    // Pose state described the old shape; start clean rather than easing in from it.
    remote.steer = 0
    remote.roll = 0
    remote.pitch = 0
  }
}
