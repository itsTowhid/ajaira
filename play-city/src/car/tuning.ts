/**
 * The one place car physics constants live. `CarController` simulates with these,
 * and `net/RemoteCars` inverts the same numbers to make a remote car look like a
 * locally driven one.
 */

export const MAX_SPEED = 32
export const MAX_REVERSE = 13
export const ACCELERATION = 24
export const BRAKE_FORCE = 46
export const COAST_DRAG = 7
export const IDLE_DRAG = 9
export const MAX_STEER = 0.62
export const STEER_RATE = 4.2
/** Wheels are further apart than they are wide, so a full lock is not a 90° yaw. */
export const TURN_DIVISOR = 2.9

/** Steering authority falls off with speed, so it is shared with remote rendering. */
export function steerLimitFor(speedRatio: number): number {
  return MAX_STEER * (1 - 0.62 * speedRatio)
}

/** How fast roll/pitch chase their target, per second. */
export const POSE_RATE = 6

/** Body roll per unit of steering at full speed, in radians. */
export const ROLL_PER_STEER = 0.32

/** Dives under throttle, squats under brakes. */
export const PITCH_FROM_ACCEL = 0.004
export const MAX_PITCH = 0.05
