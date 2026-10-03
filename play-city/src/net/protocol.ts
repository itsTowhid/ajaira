/**
 * Wire format between `server/net.mjs` and the browser. The relay owns no world
 * state — the city is generated from a fixed seed on every client — so this is
 * just poses and membership.
 */

/** One remote car, as the server last heard of it. */
export interface WirePlayer {
  id: string
  /** Display name for the floating tag; '' when the player skipped the garage. */
  name: string
  color: number
  /** Numeric vehicle code, see `vehicleCode`. */
  kind: number
  x: number
  z: number
  h: number
  s: number
}

export type ServerEvent =
  /** Full roster, sent once to a joining client. Replaces whatever it had. */
  | { t: 'hello'; id: string; players: WirePlayer[] }
  /** One car appeared. */
  | { t: 'join'; id: string; name: string; color: number; kind: number; x: number; z: number; h: number; s: number }
  /** One car went away. */
  | { t: 'leave'; id: string }
  /** Pose batch at TICK_MS. The tuple is [x, z, h, s, kind] to keep 12 Hz small. */
  | { t: 'state'; p: Record<string, [number, number, number, number, number]> }

export type NetStatus = 'connecting' | 'online' | 'offline'

/**
 * What the player is riding. Kept out of the wire types because
 * `server/net.mjs` cannot import this file — it validates against plain numbers.
 */
export type VehicleKind = 'car' | 'bike'

export const VEHICLE_CODE: Record<VehicleKind, number> = { car: 0, bike: 1 }

export function vehicleCode(kind: VehicleKind): number {
  return VEHICLE_CODE[kind]
}

/** Anything unrecognised falls back to a car, which is always a safe render. */
export function vehicleKind(code: unknown): VehicleKind {
  return code === 1 ? 'bike' : 'car'
}

export function otherVehicle(kind: VehicleKind): VehicleKind {
  return kind === 'bike' ? 'car' : 'bike'
}

/** Broadcast period. Keep in sync with TICK_MS in server/net.mjs. */
export const TICK_MS = 83

/**
 * Remote cars render this far in the past. Arrival-time interpolation needs no
 * clock sync, which matters because client clocks are unrelated.
 */
export const INTERP_DELAY_MS = 110

/** How far past the newest snapshot we are willing to invent motion. */
export const MAX_EXTRAPOLATE_MS = 250

/** A ToyCar is ~12 draw calls and is not instanced, so the roster is capped. */
export const MAX_REMOTE_CARS = 16

/** Past this distance a remote car is culled. See RemoteCars. */
export const CULL_DISTANCE = 260
