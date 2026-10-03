import * as THREE from 'three'
import { mat } from '../city/materials'
import type { CarPose } from './CarPose'

export interface ToyBikeOptions {
  colorIndex?: number
}

const WHEEL_RADIUS = 0.62
const WHEELBASE = 1.9

/**
 * A toy motorbike. Unlike the car, `roll` means *lean*: the whole machine lays
 * over together. The lean pivot sits on the axle line, so turning the bike over
 * swings the wheels around their own hubs instead of sinking them into the road.
 */
export class ToyBike {
  readonly group = new THREE.Group()
  readonly wheels: THREE.Mesh[] = []
  readonly frontWheels: THREE.Group[] = []

  private readonly lean = new THREE.Group()
  private readonly body = new THREE.Group()

  constructor(options: ToyBikeOptions = {}) {
    const paint = mat.car(options.colorIndex ?? 0)

    // Everything below is positioned relative to the axle line, not the road.
    const wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.14, 16)
    wheelGeometry.rotateZ(Math.PI / 2)
    for (const [z, isFront] of [
      [WHEELBASE / 2, true],
      [-WHEELBASE / 2, false],
    ] as [number, boolean][]) {
      const pivot = new THREE.Group()
      pivot.position.set(0, 0, z)
      const wheel = new THREE.Mesh(wheelGeometry, mat.tyre())
      wheel.castShadow = true
      pivot.add(wheel)
      this.lean.add(pivot)
      this.wheels.push(wheel)
      if (isFront) this.frontWheels.push(pivot)
    }

    const add = (
      parent: THREE.Object3D,
      size: [number, number, number],
      at: [number, number, number],
      material: THREE.Material,
      rotationX = 0,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
      mesh.position.set(at[0], at[1], at[2])
      mesh.rotation.x = rotationX
      mesh.castShadow = true
      parent.add(mesh)
      return mesh
    }

    // Chassis. The fairing carries the player's colour so a bike is as readable
    // on the minimap as a car.
    add(this.lean, [0.13, 0.95, 0.13], [0, 0.5, 0.9], mat.metal())
    add(this.lean, [0.88, 0.09, 0.11], [0, 0.98, 0.86], mat.metal())
    add(this.lean, [0.36, 0.3, 0.66], [0, 0.72, 0.28], paint)
    add(this.lean, [0.3, 0.12, 0.6], [0, 0.66, -0.42], mat.metal())
    add(this.lean, [0.3, 0.36, 0.5], [0, 0.28, -0.05], mat.metal())
    add(this.lean, [0.28, 0.26, 0.12], [0, 0.8, 1.0], mat.headlight())

    // Rider. Arms are aimed at the bars so the machine reads as being ridden.
    const suit = mat.rider()
    add(this.body, [0.36, 0.56, 0.3], [0, 0.95, -0.15], suit)
    add(this.body, [0.28, 0.28, 0.3], [0, 1.32, -0.05], mat.helmet())
    for (const x of [-0.22, 0.22]) {
      add(this.body, [0.12, 0.12, 0.82], [x, 1.015, 0.455], suit, 0.086)
      add(this.body, [0.14, 0.46, 0.16], [x * 0.8, 0.6, -0.04], suit, 0.22)
    }

    this.lean.add(this.body)
    this.group.add(this.lean)
  }

  /** The single visual path, same contract as `ToyCar.setPose`. */
  setPose(pose: CarPose) {
    this.group.position.set(pose.x, 0, pose.z)
    this.group.rotation.y = pose.heading
    this.lean.rotation.z = pose.roll
    this.lean.position.y = WHEEL_RADIUS + pose.bobY
    this.body.rotation.x = pose.pitch
    for (const pivot of this.frontWheels) pivot.rotation.y = pose.steer
    for (const wheel of this.wheels) wheel.rotation.x = pose.wheel
  }

  /**
   * Frees this bike's geometries. Materials come from the shared `mat.*` cache
   * and are never disposed. Geometries are deduped because both wheels share one.
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
