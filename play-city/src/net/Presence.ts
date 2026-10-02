import { GRID, LANE, ROAD_LINES, blockCenter } from '../city/layout'
import { PALETTE } from '../city/materials'
import type { CarSpawn, CarTelemetry } from '../car/CarController'
import { TICK_MS, type NetStatus, type ServerEvent } from './protocol'

const ID_KEY = 'play-city:player-id'
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

/** Ignore sub-centimetre jitter; it is just noise in the interpolation buffer. */
const MOVE_EPSILON = 0.05
const TURN_EPSILON = 0.01
/** A parked car still has to prove it is alive. */
const KEEPALIVE_MS = 1000

/** One remote car as we currently believe it to be. */
export interface RemoteState {
  id: string
  color: number
  x: number
  z: number
  h: number
  s: number
}

const randInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1))

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
 * A point on tarmac, in the correct lane, mirroring `laneOffset`/`headingFor` in
 * city/traffic.ts. With `MAX_REMOTE_CARS` slots, two players landing on the same
 * spot is rare and self-corrects within a second.
 */
function pickSpawn(): CarSpawn {
  const road = ROAD_LINES[randInt(0, ROAD_LINES.length - 1)]
  const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1
  return {
    x: road + (dir > 0 ? -LANE : LANE),
    z: blockCenter(randInt(0, GRID - 1)) + (Math.random() * 18 - 9),
    heading: dir > 0 ? 0 : Math.PI,
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

function toRemote(wire: { id: string; color: number; x: number; z: number; h: number; s: number }): RemoteState | null {
  if (!wire || !ID_PATTERN.test(wire.id)) return null
  if (![wire.color, wire.x, wire.z, wire.h, wire.s].every(isFiniteNumber)) return null
  return { id: wire.id, color: wire.color, x: wire.x, z: wire.z, h: wire.h, s: wire.s }
}

/**
 * Owns this client's identity and the roster, and nothing else. `RemoteCars` reads
 * `players`; `main` calls `announce` once a frame. No method here throws — the
 * game must stay fully playable with no server at all.
 */
export class Presence {
  readonly id: string = readId()
  readonly color: number = hashColor(this.id)
  readonly spawn: CarSpawn = pickSpawn()

  status: NetStatus = 'connecting'
  /** Replaced wholesale on `hello`, upserted on `join`/`state`, pruned on `leave`. */
  players = new Map<string, RemoteState>()

  private source: EventSource | null = null
  // -Infinity, not 0: performance.now() is time since page load, so a player who
  // drives in the first frame would otherwise have their opening pose throttled.
  private lastSend = Number.NEGATIVE_INFINITY
  private lastX = Number.NaN
  private lastZ = Number.NaN
  private lastH = Number.NaN

  constructor() {
    this.connect()
  }

  /** Fire-and-forget. At most one message per TICK_MS, and only when something moved. */
  announce(telemetry: CarTelemetry) {
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
        color: String(this.color),
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
    }
  }

  close() {
    this.source?.close()
    this.source = null
    this.status = 'offline'
  }
}
