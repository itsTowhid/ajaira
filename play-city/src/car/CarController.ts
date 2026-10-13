import * as THREE from 'three'
import type { BoxCollider, CircleCollider } from '../city/layout'
import type { Vehicle } from './vehicle'
import { CAR_PROFILE, POSE_RATE, steerLimitFor, type VehicleProfile } from './tuning'

export interface DriveInput {
  throttle: number
  steer: number
}

export interface CarSpawn {
  x: number
  z: number
  heading: number
}

const DEFAULT_SPAWN: CarSpawn = { x: 0, z: 0, heading: 0 }

export interface CarTelemetry {
  x: number
  z: number
  h: number
  s: number
}

export class CarController {
  readonly position = new THREE.Vector3()
  heading = 0
  steerAngle = 0
  speed = 0
  readonly breakableHits = new Set<number>()
  readonly trafficHits = new Set<number>()

  private roll = 0
  private pitch = 0
  private bobTime = 0
  private wheelAngle = 0

  private y = 0
  private vy = 0
  private airborne = false
  groundY = 0

  constructor(
    private car: Vehicle,
    spawn: CarSpawn = DEFAULT_SPAWN,
    readonly profile: VehicleProfile = CAR_PROFILE,
  ) {
    this.position.set(spawn.x, 0, spawn.z)
    this.heading = spawn.heading
    this.writePose(0)
  }

  get kmh() {
    return Math.abs(this.speed) * 3.6
  }

  get gear() {
    if (this.speed > 0.4) return 'D'
    if (this.speed < -0.4) return 'R'
    return 'N'
  }

  /** Upward launch off a ramp lip. Keeps a small floor so the pose never z-fights the road. */
  launch(v: number) {
    this.airborne = true
    this.vy = v
    this.y = Math.max(this.y, 0.1)
  }

  get airY(): number {
    return this.y
  }

  get isAirborne(): boolean {
    return this.airborne
  }

  /** The pose the network layer broadcasts. */
  get telemetry(): CarTelemetry {
    return { x: this.position.x, z: this.position.z, h: this.heading, s: this.speed }
  }

  update(dt: number, input: DriveInput, boxes: BoxCollider[], circles: CircleCollider[]) {
    const step = Math.min(dt, 0.05)
    this.breakableHits.clear()
    this.trafficHits.clear()

    const p = this.profile
    const speedRatio = Math.min(1, Math.abs(this.speed) / p.maxSpeed)
    const steerLimit = steerLimitFor(speedRatio, p)
    // Screen-right is world -X here, so a right press needs a negative yaw.
    const targetSteer = -input.steer * steerLimit
    this.steerAngle += (targetSteer - this.steerAngle) * Math.min(1, p.steerRate * step)

    if (input.throttle !== 0) {
      this.speed += input.throttle * p.acceleration * step
      this.speed =
        input.throttle > 0
          ? Math.min(this.speed, p.maxSpeed)
          : Math.max(this.speed, -p.maxReverse)
    } else {
      const drag = (p.coastDrag + p.idleDrag * (1 - speedRatio)) * step
      this.speed = Math.abs(this.speed) < drag ? 0 : this.speed - Math.sign(this.speed) * drag
    }

    this.heading += (this.speed / p.turnDivisor) * Math.tan(this.steerAngle) * step

    const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading))
    this.position.addScaledVector(forward, this.speed * step)
    this.resolveCollisions(boxes, circles, forward)

    // Vertical: ride ramps via groundY, fall when the ground drops away.
    if (!this.airborne) {
      if (this.groundY >= this.y - 0.05) {
        this.y = this.groundY
      } else {
        this.airborne = true
        this.vy = 0
      }
    }
    if (this.airborne) {
      this.y += this.vy * step
      this.vy -= 22 * step
      if (this.y <= 0 && this.groundY <= 0) {
        this.y = 0
        this.vy = 0
        this.airborne = false
        this.speed *= 0.94
      } else if (this.y <= this.groundY && this.vy < 0) {
        this.y = this.groundY
        this.vy = 0
        this.airborne = false
        this.speed *= 0.94
      }
    }
    this.y = Math.max(0, this.y)

    const targetRoll = this.steerAngle * speedRatio * p.leanPerSteer
    const targetPitch = -input.throttle * speedRatio * p.maxPitch
    this.roll += (targetRoll - this.roll) * Math.min(1, POSE_RATE * step)
    this.pitch += (targetPitch - this.pitch) * Math.min(1, POSE_RATE * step)
    this.bobTime += step * (4 + speedRatio * 26)
    this.wheelAngle += (this.speed * step) / this.car.wheelRadius

    this.writePose(speedRatio)
  }

  private writePose(speedRatio: number) {
    this.car.setPose({
      x: this.position.x,
      y: this.y,
      z: this.position.z,
      heading: this.heading,
      roll: this.roll,
      pitch: this.pitch,
      bobY: Math.sin(this.bobTime) * this.profile.bobAmplitude * (0.3 + speedRatio),
      steer: this.steerAngle,
      wheel: this.wheelAngle,
    })
  }

  private resolveCollisions(boxes: BoxCollider[], circles: CircleCollider[], forward: THREE.Vector3) {
    const halfWidth = this.profile.bodyHalfWidth
    const samples: [number, number][] = [
      [0, 1.5],
      [0, 0],
      [0, -1.5],
      [halfWidth, 0.4],
      [-halfWidth, 0.4],
    ]

    const cos = Math.cos(this.heading)
    const sin = Math.sin(this.heading)
    let solid = false
    let smashed = false

    const pushOutBox = (px: number, pz: number, box: BoxCollider) => {
      const dx = this.position.x + px - box.x
      const dz = this.position.z + pz - box.z
      const overlapX = box.hw + halfWidth - Math.abs(dx)
      const overlapZ = box.hd + halfWidth - Math.abs(dz)
      if (overlapX <= 0 || overlapZ <= 0) return false
      if (overlapX < overlapZ) {
        this.position.x += Math.sign(dx || 1) * overlapX
      } else {
        this.position.z += Math.sign(dz || 1) * overlapZ
      }
      return true
    }

    for (const [offsetX, offsetZ] of samples) {
      const px = this.position.x + forward.x * offsetZ + cos * offsetX
      const pz = this.position.z + forward.z * offsetZ - sin * offsetX

      for (const box of boxes) {
        if (box.destroyed) continue
        if (!pushOutBox(px, pz, box)) continue
        if (box.breakable === undefined) {
          solid = true
        } else {
          box.destroyed = true
          this.breakableHits.add(box.breakable)
          smashed = true
        }
      }

      for (const circle of circles) {
        if (circle.destroyed) continue
        const dx = px - circle.x
        const dz = pz - circle.z
        const distance = Math.hypot(dx, dz)
        const minDistance = circle.r + halfWidth
        if (distance >= minDistance || distance < 1e-5) continue

        const push = (minDistance - distance) * 1.02
        this.position.x += (dx / distance) * push
        this.position.z += (dz / distance) * push

        if (circle.breakable === undefined && circle.trafficIndex === undefined) {
          solid = true
        } else {
          if (circle.breakable !== undefined) {
            circle.destroyed = true
            this.breakableHits.add(circle.breakable)
            smashed = true
          }
          if (circle.trafficIndex !== undefined) this.trafficHits.add(circle.trafficIndex)
        }
      }
    }

    if (solid) this.speed *= -0.16
    else if (smashed) this.speed *= 0.88
  }

}
