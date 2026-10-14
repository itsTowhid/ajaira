import * as THREE from 'three'
import { mat } from '../city/materials'
import type { CarPose } from './CarPose'
import { Gun } from './gun'

export interface ToyPlaneOptions {
  colorIndex?: number
  scale?: number
}

export const PROPELLER_RADIUS = 0.48
const WHEELBASE = 1.8
const GEAR_RADIUS = 0.22

export class ToyPlane {
  readonly group = new THREE.Group()
  readonly body = new THREE.Group()
  readonly wheels: THREE.Mesh[] = []
  readonly frontWheels: THREE.Group[] = []
  readonly gun: Gun

  private readonly prop = new THREE.Group()
  private readonly bladeBase: number[] = []

  constructor(options: ToyPlaneOptions = {}) {
    const { colorIndex = 0, scale = 1 } = options
    const paint = mat.car(colorIndex)

    // Fuselage. Long box, +Z is forward.
    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 4.8), paint)
    fuselage.position.y = 0.95
    fuselage.castShadow = true
    this.body.add(fuselage)

    // Cockpit: glass canopy on top, slightly forward of centre.
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 1.3), mat.glass())
    canopy.position.set(0, 1.585, 0.5)
    canopy.castShadow = true
    this.body.add(canopy)

    // Main wing: wide thin box, low-mid fuselage.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.1, 0.95), paint)
    wing.position.set(0, 0.55, 0.3)
    wing.castShadow = true
    this.body.add(wing)

    // Tail: smaller wing at the rear + a vertical fin.
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.55), paint)
    tail.position.set(0, 1.2, -2.0)
    tail.castShadow = true
    this.body.add(tail)

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.8), paint)
    fin.position.set(0, 1.9, -2.0)
    fin.castShadow = true
    this.body.add(fin)

    // Landing gear: small static tyre wheels under the wings and tail.
    const gearGeometry = new THREE.CylinderGeometry(GEAR_RADIUS, GEAR_RADIUS, 0.16, 12)
    gearGeometry.rotateZ(Math.PI / 2)
    for (const [x, z] of [
      [-0.8, 0.3],
      [0.8, 0.3],
      [0, -1.5],
    ] as [number, number][]) {
      const wheel = new THREE.Mesh(gearGeometry, mat.tyre())
      wheel.position.set(x, GEAR_RADIUS, z)
      this.body.add(wheel)
    }

    // Propeller: crossed thin blades on a hub at the nose. These are the
    // "wheels": setPose drives their rotation.z from pose.wheel.
    this.prop.position.set(0, 0.95, 2.45)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.24, 10), mat.metal())
    hub.rotation.x = Math.PI / 2
    this.prop.add(hub)
    for (const roll of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.9, 0.07), mat.tyre())
      blade.rotation.z = roll
      blade.castShadow = true
      this.prop.add(blade)
      this.wheels.push(blade)
      this.bladeBase.push(roll)
    }
    this.body.add(this.prop)

    this.group.add(this.body)

    // Cannon on the fuselage spine AHEAD of the wings: high enough to read
    // from the chase camera looking down the tail, and well clear of the prop
    // disc at the nose. +Z is forward.
    this.gun = new Gun()
    this.gun.group.position.set(0, 1.5, 1.2)
    this.body.add(this.gun.group)

    this.group.scale.setScalar(scale)
  }

  setSteer(angle: number) {
    // No steering wheels on a plane; yaw the prop hub a touch so the generic
    // pose path still visibly does something with steer.
    this.prop.rotation.y = angle * 0.3
  }

  spin(amount: number) {
    for (const blade of this.wheels) blade.rotation.z += amount
  }

  /** The single visual path for a plane, same contract as `ToyCar.setPose`. */
  setPose(pose: CarPose) {
    this.group.position.set(pose.x, pose.y ?? 0, pose.z)
    this.group.rotation.y = pose.heading
    this.body.rotation.z = pose.roll
    this.body.rotation.x = pose.pitch
    this.body.position.y = pose.bobY
    this.setSteer(pose.steer)
    for (let i = 0; i < this.wheels.length; i++) this.wheels[i].rotation.z = this.bladeBase[i] + pose.wheel
  }

  /**
   * Frees this plane's geometries. Materials come from the shared `mat.*` cache and
   * are never disposed. Geometries are deduped because the prop blades share pairs.
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
    return PROPELLER_RADIUS
  }

  get wheelbase() {
    return WHEELBASE
  }
}
