/**
 * A complete car pose. Both `CarController` (which simulates) and `net/RemoteCars`
 * (which interpolates somebody else's car) produce one of these, so a remote car
 * goes through exactly the same visual path as the local one.
 */
export interface CarPose {
  x: number
  z: number
  /** Yaw about Y, radians. 0 points down +Z. */
  heading: number
  /** Body roll about Z, radians. */
  roll: number
  /** Body pitch about X, radians. */
  pitch: number
  /** Body height offset, metres. */
  bobY: number
  /** Front wheel angle, radians. Negative steers screen-right. */
  steer: number
  /** Absolute wheel spin, radians. */
  wheel: number
}
