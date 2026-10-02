import * as THREE from 'three'
import { mat } from '../city/materials'
import type { CarPose } from './CarPose'

export interface ToyCarOptions {
  colorIndex?: number
  scale?: number
}

const WHEEL_RADIUS = 0.56
const WHEELBASE = 2.9
const BODY_LENGTH = 4.3

export class ToyCar {
  readonly group = new THREE.Group()
  readonly body = new THREE.Group()
  readonly wheels: THREE.Mesh[] = []
  readonly frontWheels: THREE.Group[] = []

  constructor(options: ToyCarOptions = {}) {
    const { colorIndex = 0, scale = 1 } = options
    const paint = mat.car(colorIndex)

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, BODY_LENGTH), paint)
    chassis.position.y = 0.86
    chassis.castShadow = true
    this.body.add(chassis)

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.8, 2.35), paint)
    cabin.position.set(0, 1.56, 0.1)
    cabin.castShadow = true
    this.body.add(cabin)

    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.66, 0.12), mat.glass())
    windshield.position.set(0, 1.56, 1.32)
    windshield.rotation.x = -0.3
    this.body.add(windshield)

    const rearGlass = windshield.clone()
    rearGlass.position.set(0, 1.56, -1.12)
    rearGlass.rotation.x = 0.3
    this.body.add(rearGlass)

    const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.26, 0.3), mat.metal())
    bumperFront.position.set(0, 0.72, BODY_LENGTH / 2 - 0.05)
    this.body.add(bumperFront)

    const bumperRear = bumperFront.clone()
    bumperRear.position.z = -BODY_LENGTH / 2 + 0.05
    this.body.add(bumperRear)

    for (const x of [-0.65, 0.65]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.12), mat.headlight())
      headlight.position.set(x, 0.98, BODY_LENGTH / 2 + 0.02)
      this.body.add(headlight)

      const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.1), mat.taillight())
      taillight.position.set(x, 0.98, -BODY_LENGTH / 2 - 0.02)
      this.body.add(taillight)
    }

    const wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.36, 16)
    wheelGeometry.rotateZ(Math.PI / 2)
    for (const [x, z, isFront] of [
      [-0.98, 1.3, true],
      [0.98, 1.3, true],
      [-0.98, -1.3, false],
      [0.98, -1.3, false],
    ] as [number, number, boolean][]) {
      const pivot = new THREE.Group()
      pivot.position.set(x, WHEEL_RADIUS, z)
      const wheel = new THREE.Mesh(wheelGeometry, mat.tyre())
      wheel.castShadow = true
      pivot.add(wheel)
      this.body.add(pivot)
      this.wheels.push(wheel)
      if (isFront) this.frontWheels.push(pivot)
    }

    this.group.add(this.body)
    this.group.scale.setScalar(scale)
  }

  setSteer(angle: number) {
    for (const pivot of this.frontWheels) pivot.rotation.y = angle
  }

  spin(amount: number) {
    for (const wheel of this.wheels) wheel.rotation.x += amount
  }

  /** The single visual path for a car, local or remote. */
  setPose(pose: CarPose) {
    this.group.position.set(pose.x, 0, pose.z)
    this.group.rotation.y = pose.heading
    this.body.rotation.z = pose.roll
    this.body.rotation.x = pose.pitch
    this.body.position.y = pose.bobY
    this.setSteer(pose.steer)
    for (const wheel of this.wheels) wheel.rotation.x = pose.wheel
  }

  /**
   * Frees this car's geometries. Materials come from the shared `mat.*` cache and
   * are never disposed. Geometries are deduped because all four wheels share one.
   */
  dispose() {
    this.group.removeFromParent()
    const geometries = new Set<THREE.BufferGeometry>()
    this.group.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry
      if (geometry) geometries.add(geometry)
    })
    for (const geometry of geometries) geometry.dispose()
  }

  get wheelRadius() {
    return WHEEL_RADIUS
  }

  get wheelbase() {
    return WHEELBASE
  }
}
