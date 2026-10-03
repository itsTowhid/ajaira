/**
 * A complete pose. Both `CarController` (which simulates) and `net/RemoteCars`
 * (which interpolates somebody else's vehicle) produce one of these, so a remote
 * vehicle goes through exactly the same visual path as the local one.
 */
export interface CarPose {
  x: number
  z: number
  /** Yaw about Y, radians. 0 points down +Z. */
  heading: number
  /** Body roll about Z, radians. For a bike this is the lean. */
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
