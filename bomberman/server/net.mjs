/**
 * Minimal relay for bomberman 2P, same shape as play-city's SSE relay.
 * Plain ESM JavaScript on purpose: keep out of tsc (allowJs is off).
 * No world sim on server: host client is authoritative for crates/bombs,
 * server just relays {pose + bomb events} at 12Hz.
 * Endpoints: GET /api/stream?id=.. -> SSE, POST /api/state?id=..
 */
const TICK_MS = 83
const sessions = new Map()

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    return true
  } catch {
    return false
  }
}

function drop(s) {
  if (sessions.get(s.id) !== s) return
  sessions.delete(s.id)
  try {
    s.res.end()
  } catch {
    /* gone */
  }
  for (const o of sessions.values()) write(o.res, 'leave', { t: 'leave', id: s.id })
}

function handler(req, res, next) {
  let url
  try {
    url = new URL(req.url ?? '/', 'http://bomber.local')
  } catch {
    next()
    return
  }
  if (url.pathname === '/api/stream' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? `${Date.now()}`
    const prev = sessions.get(id)
    if (prev) {
      try {
        prev.res.end()
      } catch {}
      sessions.delete(id)
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(':ok\n\n')
    const session = { id, res, dirty: false, last: null, lastSeen: Date.now() }
    const existing = [...sessions.values()].map((o) => ({ id: o.id, last: o.last }))
    sessions.set(id, session)
    write(res, 'hello', { t: 'hello', id, players: existing })
    for (const o of sessions.values()) {
      if (o !== session) write(o.res, 'join', { t: 'join', id })
    }
    req.on('close', () => drop(session))
    return
  }
  if (url.pathname === '/api/state' && req.method === 'POST') {
    const id = url.searchParams.get('id')
    const s = id ? sessions.get(id) : undefined
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (s) {
        try {
          s.last = JSON.parse(raw)
          s.dirty = true
          s.lastSeen = Date.now()
        } catch {}
      }
      res.statusCode = 204
      res.end()
    })
    return
  }
  next()
}

const tick = setInterval(() => {
  const states = {}
  let n = 0
  for (const s of sessions.values()) {
    if (!s.dirty) continue
    s.dirty = false
    states[s.id] = s.last
    n++
  }
  if (n > 0) for (const s of sessions.values()) write(s.res, 'state', { t: 'state', p: states })
}, TICK_MS)
tick.unref?.()

export function createBomberRelay() {
  return {
    name: 'bomberman:relay',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
