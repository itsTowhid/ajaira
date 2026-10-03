import * as THREE from 'three'
import type { VehicleKind } from '../net/protocol'
import { BIKE_PROFILE, CAR_PROFILE, type VehicleProfile } from './tuning'
import type { CarPose } from './CarPose'
import { ToyBike } from './ToyBike'
import { ToyCar } from './ToyCar'

/**
 * What a drivable thing has to be for `CarController` and `net/RemoteCars` to
 * work with it. `ToyCar` and `ToyBike` both satisfy this structurally.
 */
export interface Vehicle {
  readonly group: THREE.Group
  /** Drives wheel spin, so it must be the radius actually on screen. */
  readonly wheelRadius: number
  setPose(pose: CarPose): void
  dispose(): void
}

export const VEHICLE_ORDER: readonly VehicleKind[] = ['car', 'bike']

export function profileFor(kind: VehicleKind): VehicleProfile {
  return kind === 'bike' ? BIKE_PROFILE : CAR_PROFILE
}

export function createVehicle(kind: VehicleKind, colorIndex: number): Vehicle {
  return kind === 'bike' ? new ToyBike({ colorIndex }) : new ToyCar({ colorIndex })
}

export function vehicleLabel(kind: VehicleKind): string {
  return kind === 'bike' ? 'bike' : 'car'
}
