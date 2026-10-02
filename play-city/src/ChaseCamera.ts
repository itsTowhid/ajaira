import * as THREE from 'three'

const MODES = [
  { name: 'chase', distance: 16, pitch: 0.3, lookAhead: 6 },
  { name: 'close', distance: 10, pitch: 0.2, lookAhead: 8 },
  { name: 'aerial', distance: 46, pitch: 0.95, lookAhead: 2 },
  { name: 'map', distance: 150, pitch: 1.5, lookAhead: 0 },
] as const

export type CameraMode = (typeof MODES)[number]['name']

export class ChaseCamera {
  mode: CameraMode = 'chase'
  yawOffset = 0

  private followYaw = 0
  private pitch: number = MODES[0].pitch
  private distance: number = MODES[0].distance
  private manualTimer = 0
  private initialised = false
  private lookAt = new THREE.Vector3()

  constructor(private camera: THREE.PerspectiveCamera) {}

  cycleMode() {
    const index = MODES.findIndex((mode) => mode.name === this.mode)
    this.mode = MODES[(index + 1) % MODES.length].name
  }

  update(dt: number, carPosition: THREE.Vector3, heading: number, speed: number, drag: { x: number; y: number }, zoom: number) {
    const config = MODES.find((mode) => mode.name === this.mode)!

    if (drag.x !== 0 || drag.y !== 0) {
      this.yawOffset -= drag.x * 0.005
      this.pitch = THREE.MathUtils.clamp(this.pitch + drag.y * 0.003, 0.05, 1.52)
      this.manualTimer = 2.2
    }
    if (zoom !== 0) {
      this.distance = THREE.MathUtils.clamp(this.distance * (1 + zoom * 0.0012), 6, 220)
    }
    this.manualTimer = Math.max(0, this.manualTimer - dt)

    const targetDistance = config.distance
    const targetPitch = config.pitch
    this.distance += (targetDistance - this.distance) * Math.min(1, 2 * dt)
    this.pitch += (targetPitch - this.pitch) * Math.min(1, 2 * dt)

    if (!this.initialised) {
      this.initialised = true
      this.followYaw = heading
      this.yawOffset = 0
      this.camera.position.set(
        carPosition.x - Math.sin(this.followYaw) * this.distance,
        this.distance * 0.5 + 3,
        carPosition.z - Math.cos(this.followYaw) * this.distance,
      )
    }

    const autoYaw = speed < -1 ? heading + Math.PI : heading
    if (this.manualTimer <= 0) {
      this.yawOffset *= 1 - Math.min(1, 1.6 * dt)
      const delta = ((autoYaw - this.followYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      this.followYaw += delta * Math.min(1, Math.min(1, 2.2 * dt) * (0.25 + Math.min(1, Math.abs(speed) / 20)))
    } else {
      this.followYaw = autoYaw
    }

    const yaw = this.followYaw + this.yawOffset
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const desired = carPosition
      .clone()
      .addScaledVector(forward, -this.distance * Math.cos(this.pitch))
      .add(new THREE.Vector3(0, this.distance * Math.sin(this.pitch) + 2.2, 0))

    const damping = 1 - Math.exp(-7 * dt)
    this.camera.position.lerp(desired, damping)

    this.lookAt
      .copy(carPosition)
      .addScaledVector(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)), config.lookAhead)
      .add(new THREE.Vector3(0, 2.2, 0))
    this.camera.lookAt(this.lookAt)

    const keepAbove = 1.6
    if (this.camera.position.y < keepAbove) this.camera.position.y = keepAbove
  }
}
