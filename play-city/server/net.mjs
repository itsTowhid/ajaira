/**
 * Multiplayer relay for play-city, mounted as a Vite middleware.
 *
 * Plain ESM JavaScript on purpose: `@types/node` is not installed here, so any
 * `node:http` import would break `tsc --noEmit`, and `allowJs` is off so this
 * file stays outside the TypeScript program.
 *
 * This module owns no world state. The city is generated from a fixed seed on
 * every client, so the server only has to relay each connection's id, colour
 * and pose. Endpoints:
 *
 *   GET  /api/stream?id=<uuid>&color=<0-7>&kind=<0-1>[&x&z&h]  opens the SSE stream, and *is* the session
 *   POST /api/state?id=<uuid>  body {x, z, h, s, kind}         -> 204
 *
 * NOTE: this file does not hot-reload. The middleware is installed once when the
 * Vite server boots, so restart `pnpm dev` after editing it.
 */

const TICK_MS = 83 // 12 Hz broadcast; keep in sync with TICK_MS in src/net/protocol.ts
const UPKEEP_MS = 15_000
const STALE_MS = 45_000
const MAX_PLAYERS = 64
const BODY_LIMIT = 4096

// CITY_HALF + 70 from src/car/CarController.ts — the client clamps itself to the
// same box, so anything outside it is a bug or a hostile client.
const POSITION_LIMIT = 250
// Above MAX_SPEED (32) and MAX_REVERSE (13) in src/car/tuning.ts.
const SPEED_LIMIT = 35
const COLOUR_COUNT = 8
// Keep in sync with VEHICLE_CODE in src/net/protocol.ts (car = 0, bike = 1).
const VEHICLE_CODES = [0, 1]
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

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
    color: session.color,
    kind: session.kind,
    x: session.x,
    z: session.z,
    h: session.h,
    s: session.s,
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
    color: Number.isFinite(rawColour) ? clamp(Math.round(rawColour), 0, COLOUR_COUNT - 1) : 0,
    kind: vehicleCode(url.searchParams.get('kind')),
    res,
    // The client sends its spawn on the URL so peers never see a car sitting at
    // the origin for one tick before the first state POST lands.
    x: number(url.searchParams.get('x'), POSITION_LIMIT) ?? 0,
    z: number(url.searchParams.get('z'), POSITION_LIMIT) ?? 0,
    h: angle(url.searchParams.get('h')) ?? 0,
    s: 0,
    dirty: false,
    lastSeen: Date.now(),
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
