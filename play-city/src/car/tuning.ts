/**
 * Per-vehicle feel. `CarController` simulates with these, and `net/RemoteCars`
 * inverts the same numbers to make somebody else's vehicle look like a locally
 * driven one — so a profile must describe appearance as well as physics.
 */
export interface VehicleProfile {
  readonly maxSpeed: number
  readonly maxReverse: number
  readonly acceleration: number
  readonly brakeForce: number
  readonly coastDrag: number
  readonly idleDrag: number
  readonly maxSteer: number
  readonly steerRate: number
  /** Wheels are further apart than they are wide, so a full lock is not a 90° yaw. */
  readonly turnDivisor: number
  /** How fast steering authority falls off as speed rises. */
  readonly steerFalloff: number
  /** Half-width of the collision body, metres. */
  readonly bodyHalfWidth: number
  /** Circle collider radius for remote copies of this vehicle. */
  readonly colliderRadius: number
  /** Lean/roll per unit of steer at full speed, radians. */
  readonly leanPerSteer: number
  readonly pitchFromAccel: number
  readonly maxPitch: number
  /** Suspension bob amplitude at rest, metres. */
  readonly bobAmplitude: number
}

/** How fast roll/pitch chase their target, per second. */
export const POSE_RATE = 6

export const CAR_PROFILE: VehicleProfile = {
  maxSpeed: 32,
  maxReverse: 13,
  acceleration: 24,
  brakeForce: 46,
  coastDrag: 7,
  idleDrag: 9,
  maxSteer: 0.62,
  steerRate: 4.2,
  turnDivisor: 2.9,
  steerFalloff: 0.62,
  bodyHalfWidth: 1.05,
  colliderRadius: 1.6,
  leanPerSteer: 0.32,
  pitchFromAccel: 0.004,
  maxPitch: 0.05,
  bobAmplitude: 0.015,
}

/**
 * Slower and twitchier than the car: less top end, much more shove, a far
 * tighter lock, and a narrow body that slips down alleys. The big `leanPerSteer`
 * is what makes it read as a bike rather than a slow car.
 */
export const BIKE_PROFILE: VehicleProfile = {
  maxSpeed: 27,
  maxReverse: 6,
  acceleration: 34,
  brakeForce: 42,
  coastDrag: 5.5,
  idleDrag: 6,
  maxSteer: 1.0,
  steerRate: 6.5,
  turnDivisor: 2.2,
  steerFalloff: 0.62,
  bodyHalfWidth: 0.5,
  colliderRadius: 0.75,
  leanPerSteer: 1.15,
  pitchFromAccel: 0.002,
  maxPitch: 0.035,
  bobAmplitude: 0.007,
}

export function steerLimitFor(speedRatio: number, profile: VehicleProfile): number {
  return profile.maxSteer * (1 - profile.steerFalloff * speedRatio)
}
