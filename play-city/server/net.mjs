/**
 * Multiplayer relay for play-city, mounted as a Vite middleware.
 *
 * Plain ESM JavaScript on purpose: `@types/node` is not installed here, so any
 * `node:http` import would break `tsc --noEmit`, and `allowJs` is off so this
 * file stays outside the TypeScript program.
 *
 * This module owns almost no world state. The city is generated from a fixed
 * seed on every client, so the server only has to relay each connection's id,
 * colour and pose. Combat is the one exception: hit points are server-owned so
 * a victim's client cannot un-die itself. Endpoints:
 *
 *   GET  /api/stream?id=<uuid>&color=<0-7>&kind=<0-1>[&x&z&h]  opens the SSE stream, and *is* the session
 *   POST /api/state?id=<uuid>  body {x, z, h, s, kind}         -> 204
 *   POST /api/fire?id=<uuid>   body {x, z, h, kind}            -> 204, everyone else gets `shot`
 *   POST /api/hit?id=<uuid>    body {target, damage}           -> 204, everyone gets `hit`/`wreck`
 *
 * NOTE: this file does not hot-reload. The middleware is installed once when the
 * Vite server boots, so restart `pnpm dev` after editing it.
 */

const TICK_MS = 83 // 12 Hz broadcast; keep in sync with TICK_MS in src/net/protocol.ts
const UPKEEP_MS = 15_000
const STALE_MS = 45_000
const MAX_PLAYERS = 64
const BODY_LIMIT = 4096

// CITY_HALF + 280 from src/car/CarController.ts — the client clamps itself to the
// same box (CITY_HALF 720 + 280 = 1000), so anything beyond it is a bug or a
// hostile client.
const POSITION_LIMIT = 1010
// Above MAX_SPEED (83.3) and MAX_REVERSE (25) in src/car/tuning.ts.
const SPEED_LIMIT = 100
const COLOUR_COUNT = 8
// Keep in sync with VEHICLE_CODE in src/net/protocol.ts (car = 0, bike = 1).
const VEHICLE_CODES = [0, 1]
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

// Combat bounds. MAX_DAMAGE/MAX_FIRE_RATE mirror MAX_DAMAGE/MAX_FIRE_RATE in
// src/net/protocol.ts; the server is the authority, the client is a hint.
const MAX_HP = 100
const MAX_DAMAGE = 34
const MAX_FIRE_RATE = 10
// Immunity window after (re)spawn. The client blinks for the same duration.
const SPAWN_PROTECT_MS = 3_000

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Defeats response buffering in nginx and friends.
  'X-Accel-Buffering': 'no',
}

/** id, color, res, x, z, h, s, kind, dirty, lastSeen */
const sessions = new Map()

const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value))

/** Returns a finite, clamped number, or null if the input is not usable. */
function number(value, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return clamp(value, limit)
}

/** Headings are angles: wrap rather than clamp so a car doing donuts keeps facing the right way. */
function angle(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const twoPi = Math.PI * 2
  return ((((value + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}

const round = (value) => Math.round(value * 1000) / 1000

/** Vehicle code, validated. Unknown or missing means 0 (car). */
function vehicleCode(value) {
  const code = typeof value === 'string' ? Number(value) : value
  if (!Number.isInteger(code) || !VEHICLE_CODES.includes(code)) return 0
  return code
}

function readId(url) {
  const id = url.searchParams.get('id')
  return id && ID_PATTERN.test(id) ? id : null
}

/** Display name for the floating tag. Cosmetic, so anything hostile becomes ''. */
function readName(url) {
  try {
    const raw = url.searchParams.get('name') ?? ''
    return raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16)
  } catch {
    return ''
  }
}

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    return true
  } catch {
    return false
  }
}

function comment(res, text) {
  try {
    res.write(text)
  } catch {
    /* the close handler will clean this session up */
  }
}

function broadcast(event, data, exceptId) {
  for (const session of sessions.values()) {
    if (session.id === exceptId) continue
    if (!write(session.res, event, data)) drop(session)
  }
}

function wirePlayer(session) {
  return {
    id: session.id,
    name: session.name,
    color: session.color,
    kind: session.kind,
    x: session.x,
    z: session.z,
    h: session.h,
    s: session.s,
    hp: session.hp,
  }
}

function drop(session) {
  if (sessions.get(session.id) !== session) return
  sessions.delete(session.id)
  comment(session.res, ':bye\n\n')
  try {
    session.res.end()
  } catch {
    /* already gone */
  }
  broadcast('leave', { t: 'leave', id: session.id })
}

function openStream(req, res, url) {
  const id = readId(url)
  if (!id) {
    req.resume()
    res.statusCode = 400
    res.end('bad player id')
    return
  }

  // The client owns its identity, so a second stream for the same id is a
  // reconnect (flaky network, reload): take over instead of rejecting.
  const previous = sessions.get(id)
  if (previous) {
    sessions.delete(id)
    comment(previous.res, ':bye\n\n')
    try {
      previous.res.end()
    } catch {
      /* already gone */
    }
  } else if (sessions.size >= MAX_PLAYERS) {
    req.resume()
    res.statusCode = 503
    res.end('city is full')
    return
  }

  const rawColour = Number(url.searchParams.get('color'))
  const session = {
    id,
    // Names are cosmetic: NFC-normalised, control chars stripped, capped short.
    name: readName(url),
    // clamp() here is the symmetric ±limit helper, so the 0..7 range is done
    // by hand — a clamp(raw, 0, 7) call would read limit=0 and zero every colour.
    color: Number.isFinite(rawColour) ? Math.max(0, Math.min(COLOUR_COUNT - 1, Math.round(rawColour))) : 0,
    kind: vehicleCode(url.searchParams.get('kind')),
    res,
    // The client sends its spawn on the URL so peers never see a car sitting at
    // the origin for one tick before the first state POST lands. searchParams
    // yields strings, so coerce before the number checks — before this fix the
    // ?? 0 fallback zeroed every URL spawn.
    x: number(Number(url.searchParams.get('x')), POSITION_LIMIT) ?? 0,
    z: number(Number(url.searchParams.get('z')), POSITION_LIMIT) ?? 0,
    h: angle(Number(url.searchParams.get('h'))) ?? 0,
    s: 0,
    dirty: false,
    lastSeen: Date.now(),
    // Combat: every fresh connection arrives with a full tank.
    hp: MAX_HP,
    protectedUntil: 0,
    fireTimes: [],
  }
  sessions.set(id, session)

  res.writeHead(200, SSE_HEADERS)
  res.setTimeout?.(0)
  res.socket?.setNoDelay?.(true)
  // An immediate comment flushes the headers and stops proxies from buffering.
  res.write(':ok\n\n')

  // `hello` replaces the newcomer's whole roster; everyone else gets a `join`,
  // so an arriving player never resets anybody else's interpolation buffer.
  write(res, 'hello', { t: 'hello', id, players: [...sessions.values()].filter((other) => other !== session).map(wirePlayer) })
  broadcast('join', { t: 'join', ...wirePlayer(session) }, id)

  req.on('close', () => drop(session))
}

function readJson(req) {
  return new Promise((resolve) => {
    let size = 0
    let raw = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        finish(null)
        req.destroy()
        return
      }
      raw += chunk
    })
    req.on('end', () => {
      try {
        finish(JSON.parse(raw))
      } catch {
        finish(null)
      }
    })
    req.on('error', () => finish(null))
  })
}

async function acceptState(req, res, url) {
  const id = readId(url)
  const session = id ? sessions.get(id) : undefined
  const body = await readJson(req)
  if (!session) {
    res.statusCode = id ? 409 : 400
    res.end()
    return
  }
  if (!body || typeof body !== 'object') {
    res.statusCode = 400
    res.end()
    return
  }

  // A wrecked car stays wrecked until its owner posts a fresh pose — that
  // first POST after a wreck *is* the respawn: full health and a fresh shield.
  // Peers learn about it through a max-hp `hit`, which refills their HP bars.
  const now = Date.now()
  if (session.hp <= 0) {
    session.hp = MAX_HP
    session.protectedUntil = now + SPAWN_PROTECT_MS
    broadcast('hit', { t: 'hit', target: session.id, hp: MAX_HP })
  }

  const x = number(body.x, POSITION_LIMIT)
  const z = number(body.z, POSITION_LIMIT)
  const h = angle(body.h)
  const s = number(body.s, SPEED_LIMIT)
  if (x === null || z === null || h === null || s === null) {
    res.statusCode = 400
    res.end()
    return
  }

  session.x = x
  session.z = z
  session.h = h
  session.s = s
  // Vehicle swaps ride along on the ordinary 12 Hz state, so swapping needs no
  // extra round trip and peers see it on the next tick.
  session.kind = vehicleCode(body.kind)
  session.dirty = true
  session.lastSeen = Date.now()

  res.statusCode = 204
  res.end()
}

/**
 * Somebody pulled the trigger. The shot itself carries no damage — it exists so
 * peers can render the tracer and muzzle flash. Damage goes through /api/hit,
 * which the shooter's client calls only after its local bullet actually
 * connects, so aiming stays honest.
 */
async function acceptFire(req, res, url) {
  const id = readId(url)
  const session = id ? sessions.get(id) : undefined
  const body = await readJson(req)
  if (!session) {
    res.statusCode = id ? 409 : 400
    res.end()
    return
  }
  if (!body || typeof body !== 'object') {
    res.statusCode = 400
    res.end()
    return
  }

  const x = number(body.x, POSITION_LIMIT)
  const z = number(body.z, POSITION_LIMIT)
  const h = angle(body.h)
  if (x === null || z === null || h === null) {
    res.statusCode = 400
    res.end()
    return
  }

  // Rate limit: keep a short window of fire timestamps per session. A wrecked
  // player cannot shoot, so neither can a hostile client pretending to be one.
  const now = Date.now()
  session.fireTimes = session.fireTimes.filter((time) => now - time < 1000)
  if (session.fireTimes.length >= MAX_FIRE_RATE || session.hp <= 0) {
    res.statusCode = 429
    res.end()
    return
  }
  session.fireTimes.push(now)

  broadcast('shot', { t: 'shot', id, x: round(x), z: round(z), h: round(h), kind: session.kind })

  res.statusCode = 204
  res.end()
}

/**
 * The shooter's client reports a hit its bullet actually scored on the victim.
 * The server applies the damage to its own hp copy and tells everybody,
 * including the shooter, so every screen agrees on who is hurt and by how much.
 * A wrecked victim stops moving on everyone's screen because its owner stops
 * posting state; the server stops accepting state from a wrecked session too.
 */
async function acceptHit(req, res, url) {
  const id = readId(url)
  const session = id ? sessions.get(id) : undefined
  const body = await readJson(req)
  if (!session) {
    res.statusCode = id ? 409 : 400
    res.end()
    return
  }
  if (!body || typeof body !== 'object') {
    res.statusCode = 400
    res.end()
    return
  }

  const targetId = typeof body.target === 'string' ? body.target : ''
  const target = sessions.get(targetId)
  const damage = typeof body.damage === 'number' && Number.isFinite(body.damage) ? Math.round(body.damage) : 0
  if (!target || target === session || damage <= 0 || damage > MAX_DAMAGE) {
    res.statusCode = 400
    res.end()
    return
  }
  // A shooter still on spawn protection cannot open the fight.
  if (session.protectedUntil > Date.now()) {
    res.statusCode = 403
    res.end()
    return
  }

  const now = Date.now()
  target.hp = Math.max(0, target.hp - damage)

  // broadcast() reaches every stream, the victim included — a follow-up
  // send() here would deliver every hit/wreck twice to the one car that
  // cares most about it.
  if (target.hp <= 0) {
    target.protectedUntil = now + SPAWN_PROTECT_MS
    target.fireTimes = []
    broadcast('wreck', { t: 'wreck', target: target.id, by: session.id })
  } else {
    broadcast('hit', { t: 'hit', target: target.id, hp: target.hp, by: session.id })
  }

  res.statusCode = 204
  res.end()
}

function handler(req, res, next) {
  let url
  try {
    url = new URL(req.url ?? '/', 'http://play-city.local')
  } catch {
    next()
    return
  }

  if (url.pathname === '/api/stream' && req.method === 'GET') {
    openStream(req, res, url)
    return
  }
  if (url.pathname === '/api/state' && req.method === 'POST') {
    void acceptState(req, res, url)
    return
  }
  if (url.pathname === '/api/fire' && req.method === 'POST') {
    void acceptFire(req, res, url)
    return
  }
  if (url.pathname === '/api/hit' && req.method === 'POST') {
    void acceptHit(req, res, url)
    return
  }
  next()
}

const tick = setInterval(() => {
  const states = {}
  let count = 0
  for (const session of sessions.values()) {
    if (!session.dirty) continue
    session.dirty = false
    states[session.id] = [
      round(session.x),
      round(session.z),
      round(session.h),
      round(session.s),
      session.kind,
    ]
    count += 1
  }
  if (count > 0) broadcast('state', { t: 'state', p: states })
}, TICK_MS)
tick.unref?.()

const upkeep = setInterval(() => {
  const now = Date.now()
  for (const session of [...sessions.values()]) {
    // Some proxies drop a half-closed SSE stream without ever surfacing `close`.
    if (now - session.lastSeen > STALE_MS) {
      drop(session)
      continue
    }
    comment(session.res, ':hb\n\n')
  }
}, UPKEEP_MS)
upkeep.unref?.()

export function createMultiplayer() {
  return {
    name: 'play-city:multiplayer',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
