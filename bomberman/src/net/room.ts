/**
 * SSE pose + bomb-event relay client (matches server/net.mjs).
 * Single global room, first two sessions = P1/P2.
 */
export type BombEvent = { cx: number; cz: number; range: number; seq: number }

export type NetState = {
  x: number
  z: number
  alive: boolean
  seq: number
  bombs: BombEvent[]
  pickups: string[]
  restart: number
}

export class Room {
  id: string
  private es: EventSource | null = null
  private postTimer: ReturnType<typeof setInterval> | null = null
  onHello: (existing: number) => void = () => {}
  onRemote: (id: string, s: NetState) => void = () => {}
  onLeave: (id: string) => void = () => {}
  status: string = 'solo'
  peerCount = 0
  private seen = new Set<string>()

  constructor() {
    let id = sessionStorage.getItem('bomber-id')
    if (!id) {
      id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
      sessionStorage.setItem('bomber-id', id)
    }
    this.id = id
  }

  connect() {
    try {
      this.es = new EventSource(`/bomber/api/stream?id=${encodeURIComponent(this.id)}`)
    } catch {
      return
    }
    this.es.addEventListener('hello', (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data)
        const n = Array.isArray(msg.players) ? msg.players.length : 0
        this.peerCount = n
        this.status = n === 0 ? 'host · waiting for P2' : 'guest · joined'
        this.onHello(n)
      } catch { /* ignore */ }
    })
    this.es.addEventListener('join', () => {
      this.peerCount += 1
      this.status = 'online · 2P'
    })
    this.es.addEventListener('state', (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data)
        const p = msg.p as Record<string, NetState>
        for (const [id, s] of Object.entries(p)) {
          if (id === this.id || !s || typeof s.x !== 'number') continue
          this.status = 'online · 2P'
          this.onRemote(id, s)
        }
      } catch { /* ignore */ }
    })
    this.es.addEventListener('leave', (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent).data)
        if (msg.id && msg.id !== this.id) {
          this.peerCount = Math.max(0, this.peerCount - 1)
          if (this.peerCount === 0) this.status = 'host · waiting for P2'
          this.onLeave(msg.id)
        }
      } catch { /* ignore */ }
    })
    this.es.onerror = () => {
      if (this.peerCount === 0) this.status = 'solo'
    }
  }

  /** POST at 12Hz; fire-and-forget so a missing server never breaks the game. */
  announce(get: () => NetState) {
    if (this.postTimer) return
    const send = () => {
      try {
        const body = JSON.stringify(get())
        fetch(`/bomber/api/state?id=${encodeURIComponent(this.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {})
      } catch { /* ignore */ }
    }
    send()
    this.postTimer = setInterval(send, 83)
  }

  keyFor(fromId: string, seq: number): string {
    return `${fromId}:${seq}`
  }

  seenBomb(fromId: string, seq: number): boolean {
    const k = this.keyFor(fromId, seq)
    if (this.seen.has(k)) return true
    this.seen.add(k)
    if (this.seen.size > 500) {
      const first = this.seen.values().next().value
      if (first) this.seen.delete(first)
    }
    return false
  }
}
