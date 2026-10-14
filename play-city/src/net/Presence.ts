import { PALETTE } from '../city/materials'
import type { CarSpawn, CarTelemetry } from '../car/CarController'
import { MAX_HP, TICK_MS, vehicleCode, vehicleKind, type NetStatus, type ServerEvent, type VehicleKind } from './protocol'

const ID_KEY = 'play-city:player-id'
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
/** Garage answers survive reloads, keyed next to the id. */
export const PROFILE_KEY = 'play-city:profile'

/** What the garage screen collected before the game boots. */
export interface PlayerProfile {
  name: string
  kind: VehicleKind
  colorIndex: number
}

/** Reads the saved garage answers; anything odd falls back to defaults. */
export function readProfile(): PlayerProfile {
  const fallback: PlayerProfile = { name: '', kind: 'car', colorIndex: -1 }
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, 16) : '',
      kind: parsed.kind === 'bike' ? 'bike' : parsed.kind === 'plane' ? 'plane' : 'car',
      colorIndex:
        typeof parsed.colorIndex === 'number' && Number.isInteger(parsed.colorIndex)
          ? Math.max(-1, Math.min(7, parsed.colorIndex))
          : -1,
    }
  } catch {
    return fallback
  }
}

/** Writes the garage answers so a reload (or reconnect) keeps your ride. */
export function writeProfile(profile: PlayerProfile) {
  try {
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    /* private mode: the game still runs, you just re-answer after a reload */
  }
}

/** Ignore sub-centimetre jitter; it is just noise in the interpolation buffer. */
const MOVE_EPSILON = 0.05
const TURN_EPSILON = 0.01
/** A parked car still has to prove it is alive. */
const KEEPALIVE_MS = 1000

/** One remote car as we currently believe it to be. */
export interface RemoteState {
  id: string
  name: string
  color: number
  kind: VehicleKind
  x: number
  z: number
  h: number
  s: number
  /** Server-owned hit points; undefined when talking to a pre-combat relay. */
  hp?: number
  /** True between a `wreck` and the respawn `hit`. Wrecks render nowhere. */
  dead: boolean
}

const randRange = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * `crypto.randomUUID` needs a secure context, and friends on the LAN reach this
 * over plain http, so fall back to 128 bits of hex.
 */
function makeId(): string {
  const source = globalThis.crypto
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof source?.getRandomValues === 'function') source.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Stable across reloads, so a car keeps its colour for the whole tab session. */
function readId(): string {
  const fresh = makeId()
  try {
    const existing = sessionStorage.getItem(ID_KEY)
    if (existing && ID_PATTERN.test(existing)) return existing
    sessionStorage.setItem(ID_KEY, fresh)
  } catch {
    /* private mode: an id per load still works, it just changes colour */
  }
  return fresh
}

function hashColor(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % PALETTE.cars.length
}

/**
 * A point in open countryside. Any nearby patch of grass will do.
 */
function pickSpawn(): CarSpawn {
  return {
    x: randRange(-60, 60),
    z: randRange(-60, 60),
    heading: Math.random() * Math.PI * 2,
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function readEvent(data: string): ServerEvent | null {
  try {
    const event = JSON.parse(data) as ServerEvent
    return event && typeof event === 'object' ? event : null
  } catch {
    return null
  }
}

function toRemote(wire: {
  id: string
  name?: string
  color: number
  kind: number
  x: number
  z: number
  h: number
  s: number
  hp?: number
}): RemoteState | null {
  if (!wire || !ID_PATTERN.test(wire.id)) return null
  if (![wire.color, wire.x, wire.z, wire.h, wire.s].every(isFiniteNumber)) return null
  return {
    id: wire.id,
    // Tolerates old peers/relays that predate names.
    name: typeof wire.name === 'string' ? wire.name : '',
    color: wire.color,
    kind: vehicleKind(wire.kind),
    x: wire.x,
    z: wire.z,
    h: wire.h,
    s: wire.s,
    hp: isFiniteNumber(wire.hp) ? wire.hp : undefined,
    dead: isFiniteNumber(wire.hp) ? wire.hp <= 0 : false,
  }
}

/** Whom a shot hit, for kill-credit toasts and stat bumps. */
export interface HitFeedback {
  target: string
  hp: number
  wrecked: boolean
  /** The killer was us. */
  byMe: boolean
  /** The victim was us (regular hits only; wrecks also fire `onWrecked`). */
  onMe: boolean
  /** Who pulled the trigger, for kill-feed text. */
  by: string
}

/**
 * Owns this client's identity and the roster, and nothing else. `RemoteCars` reads
 * `players`; `main` calls `announce` once a frame. No method here throws — the
 * game must stay fully playable with no server at all.
 */
export class Presence {
  readonly id: string = readId()
  readonly profile: PlayerProfile
  /** Display name for the floating tag; '' when the player skipped the garage. */
  readonly name: string
  readonly color: number
  readonly spawn: CarSpawn = pickSpawn()

  /** What we are riding. Told to the network in every state POST. */
  kind: VehicleKind
  status: NetStatus = 'connecting'
  /** Replaced wholesale on `hello`, upserted on `join`/`state`, pruned on `leave`. */
  players = new Map<string, RemoteState>()

  /** Server-owned health for this car. Solo play never touches it. */
  hp = MAX_HP
  /** True from our `wreck` until the respawn POST lands. */
  dead = false

  /** Shots we fired (server-echoed) and hits we scored, for HUD + toasts. */
  onShot: ((shot: { x: number; z: number; h: number; kind: VehicleKind; by: string }) => void) | null = null
  onHit: ((feedback: HitFeedback) => void) | null = null
  onWrecked: ((by: string) => void) | null = null

  private source: EventSource | null = null
  // -Infinity, not 0: performance.now() is time since page load, so a player who
  // drives in the first frame would otherwise have their opening pose throttled.
  private lastSend = Number.NEGATIVE_INFINITY
  private lastX = Number.NaN
  private lastZ = Number.NaN
  private lastH = Number.NaN

  /**
   * The garage picks colour and ride; an unpainted profile keeps the old
   * hash-of-id behaviour so anonymous players still get stable colours.
   */
  constructor(profile: PlayerProfile = { name: '', kind: 'car', colorIndex: -1 }) {
    this.profile = profile
    this.name = profile.name.trim().slice(0, 16)
    this.color = profile.colorIndex >= 0 ? profile.colorIndex : hashColor(this.id)
    this.kind = profile.kind
    this.connect()
  }

  /**
   * Swap vehicles. Clears the movement baseline so the new ride is broadcast on
   * the very next announce rather than after it has drifted past the epsilon.
   */
  setKind(kind: VehicleKind) {
    if (kind === this.kind) return
    this.kind = kind
    this.lastX = Number.NaN
    this.lastZ = Number.NaN
    this.lastH = Number.NaN
  }

  /** True while the relay still counts us as spawn-protected. Best-effort: solo is always true. */
  get shielded(): boolean {
    return this.status !== 'online'
  }

  /**
   * Pull the trigger. Fire-and-forget: the server rate-limits and relays the
   * shot to everybody else. A wrecked or offline client just does not send.
   */
  fire(x: number, z: number, h: number) {
    if (this.dead || this.status !== 'online') return
    void fetch(`/api/fire?id=${encodeURIComponent(this.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, z, h, kind: vehicleCode(this.kind) }),
      keepalive: true,
    }).catch(() => {
      /* the SSE status is the source of truth; a lost shot is a lost shot */
    })
  }

  /**
   * Report a hit our bullet actually scored. The server owns the victim's hp,
   * so the client only nominates target and damage; everyone learns the result
   * through the `hit` event, including us.
   */
  claimHit(target: string, damage: number) {
    if (this.dead || this.status !== 'online') return
    void fetch(`/api/hit?id=${encodeURIComponent(this.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, damage }),
      keepalive: true,
    }).catch(() => {
      /* a lost claim just means one free hit for the target */
    })
  }

  /**
   * Come back from a wreck: fresh spawn point, full tank. The next announce
   * POSTs immediately, which doubles as the server-side respawn signal.
   */
  respawn() {
    const at = pickSpawn()
    this.hp = MAX_HP
    this.dead = false
    this.lastX = Number.NaN
    this.lastZ = Number.NaN
    this.lastH = Number.NaN
    return at
  }

  /** Fire-and-forget. At most one message per TICK_MS, and only when something moved. */
  announce(telemetry: CarTelemetry) {
    if (this.dead) return
    const now = performance.now()
    if (now - this.lastSend < TICK_MS) return

    const moved =
      !Number.isFinite(this.lastX) ||
      Math.hypot(telemetry.x - this.lastX, telemetry.z - this.lastZ) > MOVE_EPSILON ||
      Math.abs(telemetry.h - this.lastH) > TURN_EPSILON
    if (!moved && now - this.lastSend < KEEPALIVE_MS) return

    this.lastSend = now
    this.lastX = telemetry.x
    this.lastZ = telemetry.z
    this.lastH = telemetry.h

    const body = JSON.stringify({
      x: telemetry.x,
      z: telemetry.z,
      h: telemetry.h,
      s: telemetry.s,
      kind: vehicleCode(this.kind),
    })
    void fetch(`/api/state?id=${encodeURIComponent(this.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // The SSE status is the source of truth; a dropped POST just means one
      // stale frame somewhere else in the world.
    })
  }

  private connect() {
    if (typeof EventSource === 'undefined') {
      this.status = 'offline'
      return
    }
    try {
      const query = new URLSearchParams({
        id: this.id,
        name: this.name,
        color: String(this.color),
        kind: String(vehicleCode(this.kind)),
        x: String(this.spawn.x),
        z: String(this.spawn.z),
        h: String(this.spawn.heading),
      })
      const source = new EventSource(`/api/stream?${query}`)
      this.source = source

      source.onopen = () => {
        if (this.source === source) this.status = 'online'
      }
      source.onerror = () => {
        // readyState 2 is CLOSED (EventSource gave up); 0 means it is retrying.
        this.status = source.readyState === 2 ? 'offline' : 'connecting'
      }

      source.addEventListener('hello', (event) => this.onHello(event as MessageEvent<string>))
      source.addEventListener('join', (event) => this.onJoin(event as MessageEvent<string>))
      source.addEventListener('leave', (event) => this.onLeave(event as MessageEvent<string>))
      source.addEventListener('state', (event) => this.onState(event as MessageEvent<string>))
      source.addEventListener('shot', (event) => this.onShotEvent(event as MessageEvent<string>))
      source.addEventListener('hit', (event) => this.onHitEvent(event as MessageEvent<string>))
      source.addEventListener('wreck', (event) => this.onWreckEvent(event as MessageEvent<string>))
    } catch {
      this.status = 'offline'
    }
  }

  private onHello(event: MessageEvent<string>) {
    const event_ = readEvent(event.data)
    if (!event_ || event_.t !== 'hello' || !Array.isArray(event_.players)) return
    // Replacing, not merging: a reconnect must never leave a ghost car behind.
    const next = new Map<string, RemoteState>()
    for (const wire of event_.players) {
      const remote = toRemote(wire)
      if (remote && remote.id !== this.id) next.set(remote.id, remote)
    }
    this.players = next
  }

  private onJoin(event: MessageEvent<string>) {
    const event_ = readEvent(event.data)
    if (!event_ || event_.t !== 'join') return
    const remote = toRemote(event_)
    if (remote && remote.id !== this.id) this.players.set(remote.id, remote)
  }

  private onLeave(event: MessageEvent<string>) {
    const event_ = readEvent(event.data)
    if (event_?.t === 'leave') this.players.delete(event_.id)
  }

  private onState(event: MessageEvent<string>) {
    const event_ = readEvent(event.data)
    if (!event_ || event_.t !== 'state' || !event_.p) return
    for (const id in event_.p) {
      const pose = event_.p[id]
      const existing = this.players.get(id)
      if (!existing || !Array.isArray(pose) || pose.length < 4) continue
      if (!pose.every(isFiniteNumber)) continue
      existing.x = pose[0]
      existing.z = pose[1]
      existing.h = pose[2]
      existing.s = pose[3]
      if (pose.length > 4) existing.kind = vehicleKind(pose[4])
    }
  }

  /** A peer fired. `kind` picks the muzzle height (car bonnet vs bike bars). */
  private onShotEvent(event: MessageEvent<string>) {
    const event_ = readEvent(event.data)
    if (!event_ || event_.t !== 'shot' || event_.id === this.id) return
    if (![event_.x, event_.z, event_.h].every(isFiniteNumber)) return
    this.onShot?.({ x: event_.x, z: event_.z, h: event_.h, kind: vehicleKind(event_.kind), by: event_.id })
  }

  private onHitEvent(event: MessageEvent<string>) {
    const event_ = readEvent(event.data)
    if (!event_ || event_.t !== 'hit') return
    const hp = event_.hp
    if (!isFiniteNumber(hp)) return
    const mine = event_.target === this.id
    if (mine) {
      this.hp = Math.max(0, hp)
      this.dead = false
    }
    const remote = this.players.get(event_.target)
    if (remote) {
      remote.hp = Math.max(0, hp)
      // A max-hp hit after a wreck is the respawn: the car is back.
      if (remote.dead && hp > 0) remote.dead = false
    }
    this.onHit?.({
      target: event_.target,
      hp: Math.max(0, hp),
      wrecked: false,
      byMe: event_.by === this.id,
      onMe: mine,
      by: event_.by,
    })
  }

  private onWreckEvent(event: MessageEvent<string>) {
    const event_ = readEvent(event.data)
    if (!event_ || event_.t !== 'wreck') return
    const mine = event_.target === this.id
    if (mine) {
      this.hp = 0
      this.dead = true
      this.onWrecked?.(event_.by)
      return
    }
    const remote = this.players.get(event_.target)
    if (remote) {
      remote.dead = true
      remote.hp = 0
    }
    this.onHit?.({ target: event_.target, hp: 0, wrecked: true, byMe: event_.by === this.id, onMe: false, by: event_.by })
  }

  close() {
    this.source?.close()
    this.source = null
    this.status = 'offline'
  }
}
