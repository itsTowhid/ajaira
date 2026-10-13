/**
 * Wire format between `server/net.mjs` and the browser. The relay owns no world
 * state — the city is generated from a fixed seed on every client — so this is
 * mostly poses and membership. Combat is the one server-owned bit: the relay
 * tracks hit points so a victim's own client cannot un-die itself.
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
  /** Hit points, MAX_HP at spawn. Tolerating absent fields keeps old relays working. */
  hp?: number
}

export type ServerEvent =
  /** Full roster, sent once to a joining client. Replaces whatever it had. */
  | { t: 'hello'; id: string; players: WirePlayer[] }
  /** One car appeared. */
  | { t: 'join'; id: string; name: string; color: number; kind: number; x: number; z: number; h: number; s: number; hp?: number }
  /** One car went away. */
  | { t: 'leave'; id: string }
  /** Pose batch at TICK_MS. The tuple is [x, z, h, s, kind] to keep 12 Hz small. */
  | { t: 'state'; p: Record<string, [number, number, number, number, number]> }
  /** Somebody fired. Local scope (x, z) spans the whole city — bullets live there. */
  | { t: 'shot'; id: string; x: number; z: number; h: number; kind: number }
  /** A bullet connected. `hp` is the victim's remaining health after this hit. */
  | { t: 'hit'; target: string; hp: number; by: string }
  /** A car was wrecked. It stops moving until its owner respawn it. */
  | { t: 'wreck'; target: string; by: string }

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
export const CULL_DISTANCE = 1050

/* --- Combat ------------------------------------------------------------ */

/** Hit points at full health, shared by cars and bikes alike. */
export const MAX_HP = 100

/** Damage per bullet. Four hits at 4/s downs a car in about a second. */
export const HIT_DAMAGE = 10

/** Shots per second while the trigger is held. */
export const FIRE_RATE = 4

/** Bullet flight speed, world units per second. */
export const BULLET_SPEED = 420

/** Bullets die of old age after this long — range is BULLET_SPEED * TTL. */
export const BULLET_TTL_S = 1.2

/**
 * Seconds of immunity after spawning. The server enforces it too, so camping a
 * fresh spawn is pointless; see SPAWN_PROTECT_MS in server/net.mjs.
 */
export const SPAWN_PROTECT_S = 3

/** Shots the server will accept per second and client; the rest are dropped. */
export const MAX_FIRE_RATE = 10

/** A hostile or buggy client can never claim more damage than this per hit. */
export const MAX_DAMAGE = 34

/**
 * Deepest a single hit can push a victim below zero. Hit events cap `hp` at 0
 * anyway; this is just a sanity bound on the wire value.
 */
export const MIN_HP = 0
