import * as THREE from 'three'

export interface NavigatorOptions {
  /** Radians per second at full mouse deflection. */
  yawSpeed?: number
  pitchSpeed?: number
  /** How fast the mouse offset catches up to the raw pointer (1/second). */
  damping?: number
  minDistance?: number
  maxDistance?: number
}

/**
 * Mouse-steered orbiting: horizontal pointer offset spins the camera around
 * the galaxy, vertical offset raises/lowers it. The pointer acts like a stick,
 * so small moves are slow and edges are fast. Wheel dollies, arrow keys mirror
 * the mouse, and touch drag behaves the same way.
 */
export class MouseNavigator {
  yaw = 0
  pitch = 0.55
  distance = 135

  private yawVelocity = 0
  private pitchVelocity = 0
  private targetPitch = 0.55
  private targetDistance = 135
  private stickX = 0
  private stickY = 0
  private targetX = 0
  private targetY = 0
  private keys = new Set<string>()
  private dragging = false
  private lastPointer = new THREE.Vector2()
  private idleTime = 0

  private readonly yawSpeed: number
  private readonly pitchSpeed: number
  private readonly damping: number
  private readonly minDistance: number
  private readonly maxDistance: number

  constructor(
    private camera: THREE.PerspectiveCamera,
    private target: THREE.Vector3,
    private element: HTMLElement,
    options: NavigatorOptions = {},
  ) {
    const {
      yawSpeed = 0.9,
      pitchSpeed = 0.55,
      damping = 6,
      minDistance = 25,
      maxDistance = 700,
    } = options
    this.yawSpeed = yawSpeed
    this.pitchSpeed = pitchSpeed
    this.damping = damping
    this.minDistance = minDistance
    this.maxDistance = maxDistance

    this.bindEvents()
  }

  private bindEvents() {
    const el = this.element

    el.addEventListener('pointermove', (event: PointerEvent) => {
      if (this.dragging) {
        const dx = event.clientX - this.lastPointer.x
        const dy = event.clientY - this.lastPointer.y
        this.yawVelocity -= dx * 0.006
        this.pitchVelocity += dy * 0.004
        this.lastPointer.set(event.clientX, event.clientY)
        this.idleTime = 0
        return
      }
      const rect = el.getBoundingClientRect()
      this.targetX = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.targetY = ((event.clientY - rect.top) / rect.height) * 2 - 1
      this.idleTime = 0
    })

    el.addEventListener('pointerleave', () => {
      this.targetX = 0
      this.targetY = 0
    })

    el.addEventListener('pointerdown', (event: PointerEvent) => {
      this.dragging = true
      this.lastPointer.set(event.clientX, event.clientY)
      el.setPointerCapture(event.pointerId)
    })

    const endDrag = () => {
      this.dragging = false
    }
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)

    el.addEventListener(
      'wheel',
      (event: WheelEvent) => {
        event.preventDefault()
        const factor = Math.exp(event.deltaY * 0.0012)
        this.targetDistance = THREE.MathUtils.clamp(
          this.targetDistance * factor,
          this.minDistance,
          this.maxDistance,
        )
      },
      { passive: false },
    )

    window.addEventListener('keydown', (event: KeyboardEvent) => {
      this.keys.add(event.key.toLowerCase())
    })
    window.addEventListener('keyup', (event: KeyboardEvent) => {
      this.keys.delete(event.key.toLowerCase())
    })
  }

  update(dt: number) {
    const step = Math.min(dt, 0.05)

    // Keyboard nudges add to the mouse-driven velocity.
    const keyX = (this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('arrowleft') ? 1 : 0)
    const keyY = (this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('arrowdown') ? 1 : 0)
    if (keyX !== 0 || keyY !== 0) this.idleTime = 0

    // Smooth the raw pointer offset into a "stick" value.
    const k = 1 - Math.exp(-this.damping * step)
    this.stickX += (this.targetX - this.stickX) * k
    this.stickY += (this.targetY - this.stickY) * k

    // Drift back toward centre when the pointer is parked or gone.
    this.idleTime += step
    if (this.idleTime > 2.5) {
      const ease = 1 - Math.exp(-0.8 * step)
      this.targetX += (0 - this.targetX) * ease
      this.targetY += (0 - this.targetY) * ease
    }

    const driveYaw = this.stickX * this.yawSpeed + keyX * this.yawSpeed * 0.9
    const drivePitch = -this.stickY * this.pitchSpeed + keyY * this.pitchSpeed * 0.9

    this.yawVelocity += (driveYaw - this.yawVelocity) * k
    this.pitchVelocity += (drivePitch - this.pitchVelocity) * k

    this.yaw += this.yawVelocity * step
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch + this.pitchVelocity * step,
      -1.45,
      1.45,
    )
    this.pitch += (this.targetPitch - this.pitch) * k

    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-5 * step))

    const cosP = Math.cos(this.pitch)
    this.camera.position.set(
      this.target.x + this.distance * cosP * Math.sin(this.yaw),
      this.target.y + this.distance * Math.sin(this.pitch),
      this.target.z + this.distance * cosP * Math.cos(this.yaw),
    )
    this.camera.lookAt(this.target)
  }
}
