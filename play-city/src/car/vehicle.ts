import * as THREE from 'three'
import type { VehicleKind } from '../net/protocol'
import { BIKE_PROFILE, CAR_PROFILE, PLANE_PROFILE, type VehicleProfile } from './tuning'
import type { CarPose } from './CarPose'
import { Gun } from './gun'
import { ToyBike } from './ToyBike'
import { ToyCar } from './ToyCar'
import { ToyPlane } from './ToyPlane'

/**
 * What a drivable thing has to be for `CarController` and `net/RemoteCars` to
 * work with it. `ToyCar` and `ToyBike` both satisfy this structurally.
 */
export interface Vehicle {
  readonly group: THREE.Group
  /** Drives wheel spin, so it must be the radius actually on screen. */
  readonly wheelRadius: number
  /** The roof cannon. Every ride carries one; combat code is the only reader. */
  readonly gun: Gun
  setPose(pose: CarPose): void
  dispose(): void
}

export const VEHICLE_ORDER: readonly VehicleKind[] = ['car', 'bike', 'plane']

export function profileFor(kind: VehicleKind): VehicleProfile {
  if (kind === 'bike') return BIKE_PROFILE
  if (kind === 'plane') return PLANE_PROFILE
  return CAR_PROFILE
}

export function createVehicle(kind: VehicleKind, colorIndex: number): Vehicle {
  if (kind === 'bike') return new ToyBike({ colorIndex })
  if (kind === 'plane') return new ToyPlane({ colorIndex })
  return new ToyCar({ colorIndex })
}

export function vehicleLabel(kind: VehicleKind): string {
  if (kind === 'bike') return 'bike'
  if (kind === 'plane') return 'plane'
  return 'car'
}
