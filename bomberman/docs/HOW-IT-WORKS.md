# Bomberman Toy Box — How It All Works

A beginner-friendly technical tour of this project: a 2-player Bomberman clone
built with **Three.js + TypeScript + Vite + pnpm**. Single 13×11 level,
isometric camera, online multiplayer through a tiny relay server.

Run it with:

```bash
cd bomberman
pnpm install
pnpm dev        # → http://localhost:5174/
```

Modes: solo by default · `?local2P` couch 2-player · `?bot` practice vs AI ·
open **two tabs** for online play.

---

## 1. File map — what lives where

```
bomberman/
  package.json          pnpm + three + vite + typescript (mirrors play-city)
  vite.config.ts        dev server on :5174 + mounts the relay plugin
  index.html            canvas + HUD (timer, stats, net status, banner)
  tsconfig.json         strict TS, bundler module resolution
  docs/
    stage.svg           2D mockup of the level (the theme reference)
    HOW-IT-WORKS.md     this file
  server/
    net.mjs             ★ multiplayer relay (plain JS Vite middleware)
    net.d.mts           types for net.mjs so `tsc` accepts the import
  src/
    main.ts             ★ everything game: scene, loop, rules, netcode wiring
    style.css           glassmorphism HUD
    game/
      level.ts          ★ grid math: 13×11, pillars, crates, cell↔world
      stage.ts          ★ 3D art: textures, arena, players, bombs, flames
      powerups.ts       powerup types, drops, meshes
    net/
      room.ts           ★ relay client: SSE in, POST out, dedup
```

Files marked ★ are the ones that matter most. The rest is scaffolding.

---

## 2. Three.js crash course (just what this game uses)

Three.js renders a **scene graph** every frame. The five ideas you need:

| Concept | What it is | Example in this game |
|---|---|---|
| `Scene` | container for everything visible | `src/main.ts` — arena, players, bombs, flames |
| `Camera` | viewpoint | `PerspectiveCamera(45°)` at `(0, 14.5, 9.5)`, tilted top-down = isometric ¾ view |
| `Renderer` | draws scene→canvas each frame | `WebGLRenderer` + ACES tone mapping + soft shadows |
| `Mesh` = geometry + material | geometry = shape, material = paint | floor tile = `RoundedBoxGeometry` + grass `MeshStandardMaterial` |
| `Light` | what makes materials visible | hemisphere (sky/ground bounce) + warm sun with shadows + cool fill |

The **game loop** (`src/main.ts`, bottom) is the heartbeat every Three.js app has:

```ts
const clock = new THREE.Clock()
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05) // seconds since last frame
  // ... move players, tick bombs, update HUD ...
  renderer.render(scene, camera)              // draw everything
  requestAnimationFrame(frame)                // schedule next frame (~60fps)
}
```

`dt` (delta time) keeps movement speed frame-rate independent:
`move(f, dx, dz, dt)` advances `f.speed * dt` world units per frame.

Lighting setup (`src/main.ts`):

```ts
scene.add(new THREE.HemisphereLight(0xcdeaff, 0x5f7038, 0.95)) // sky/ground bounce
const sun = new THREE.DirectionalLight(0xfff1d0, 2.4)          // warm key light
sun.castShadow = true                                          // the only shadow caster
const fill = new THREE.DirectionalLight(0xbde0fe, 0.55)        // cool fill, no shadow
const flash = new THREE.PointLight(0xffb703, 0, 14, 1.8)       // reused explosion flash
```

One shadow-casting light + one reusable flash light keeps it fast.
`renderer.toneMapping = ACESFilmicToneMapping` gives the soft toy-like look.

---

## 3. The grid: `src/game/level.ts`

Everything gameplay-related happens on a **13×11 integer grid**; Three.js only
handles drawing. Two helpers translate between the two worlds (tile size = 1,
arena centered on origin):

```ts
export function cellToWorld(cx: number, cz: number) {
  return { x: cx - (COLS - 1) / 2, z: cz - (ROWS - 1) / 2 }
}
export function worldToCell(x: number, z: number) {
  return { cx: Math.round(x + (COLS - 1) / 2), cz: Math.round(z + (ROWS - 1) / 2) }
}
```

Layout rules:

- **Border** (`cx/cz == 0` or max) and **even/even interior cells** are solid
  pillars — `isPillar()`.
- Everything else may hold a **crate**, rolled from a **seeded RNG**
  (`mulberry32`). Same seed → same board on every machine. This is load-bearing
  for multiplayer (see §6).
- The 3 cells around each spawn are kept clear (`inSafeZone`) so you never
  spawn trapped.

---

## 4. The 3D art: `src/game/stage.ts`

No model files — every visual is generated in code:

- **Procedural canvas textures**: `canvasTex()` paints grass speckles, crate
  planks + X-brace + nails, wood grain, stone blocks onto `<canvas>` and wraps
  them in `THREE.CanvasTexture`. Cheap, no assets to download.
- **Rounded boxes** (`RoundedBoxGeometry` from `three/addons/…`) for the toy
  look: floor tiles, wood border walls with cap rails, stone pillars with moss
  caps, crates with slight rotation jitter (seeded, so both peers match).
- The arena sits on a **soil diorama base**; the scene adds a gradient **sky
  dome** and distant **toy hills** (`src/main.ts`).
- `makePlayer(color)` builds the bean: blob shadow → base ring → capsule body
  → cream belly → eyes/pupils/blush/head-shine → feet. Players rotate
  (`mesh.rotation.y = atan2(dx, dz)`) to face their move direction.
- `makeBomb()` builds a glossy sphere + highlight + cap + curved fuse
  (`TubeGeometry` along a bezier) + flickering `spark` (found by name each
  frame: `mesh.getObjectByName('spark')`).
- `makeFlameCell(hot)` builds **3 nested boxes** (orange → yellow → white-hot);
  sudden-death flames use the red-hot variant.

---

## 5. Rules & motion: `src/main.ts`

### 5.1 Circle-vs-grid collision

The player is a circle of radius `BODY_R = 0.3`. `hitsSolid(x, z)` finds every
grid cell the circle overlaps (cells are centered on integers, so
`cell = floor(coord + 0.5)`) and tests each with `solidCell()` (out of bounds,
pillar, crate, or live bomb). Movement is applied **per axis**, so sliding
along walls works:

```ts
const nx = f.x + dx * f.speed * dt
if (!hitsSolid(nx, f.z, f.pass)) f.x = nx
const nz = f.z + dz * f.speed * dt
if (!hitsSolid(f.x, nz, f.pass)) f.z = nz
```

The `pass: Set<string>` is the classic Bomberman walk-out rule: the bomb cell
you are standing on stays passable **while your circle still overlaps it**
(`circleOverlapsCell`), and turns solid the moment you leave — so you can
always escape your own bomb but can never walk back onto one.

### 5.2 Bombs & chain reactions

`dropBomb()` refuses if you are at your bomb cap, the cell already has a bomb,
or no free neighbour exists (anti-trap check). Bombs fuse for 2.6s, pulse
faster near the end, then `explode()`:

1. removes itself from the bomb list **first** (so chains can't loop),
2. walks 4 rays up to `range`, stopped by pillars, detonating the first crate
   hit (which may spawn a powerup, §5.3),
3. spawns layered flame cells + a flash-light pop, kills fighters on blast
   cells,
4. **chain-reacts**: any other live bomb on a blast cell explodes recursively.

The fuse loop re-checks `bombs.includes(b)` because `explode()` may already
have removed that bomb as part of someone else's chain.

### 5.3 Powerups

`rollPower(cx, cz)` in `src/game/powerups.ts` is **deterministic** — a hash of
the cell coordinates — so both online peers spawn the *same* powerup without
sending it over the wire. Types: `bomb` (+1 cap, max 6), `fire` (+1 range,
max 6), `speed` (+0.7, max 7). Meshes: cream base + floating 3D icon + glow
ring + label sprite. Unpicked rewards expire after 12s (`POWER_TTL`), blinking
during the last 3s; pickups are broadcast so the peer removes its copy too.

### 5.4 Match flow

90s timer in the HUD → `SUDDEN DEATH` (red hazard flames on random free cells
every 1.2s) → win/draw banner → `R` restarts (`resetMatch()` rebuilds stage,
crates, fighters from the same seed, so both peers reset identically).

`?bot` drives P2 with a random-walk AI that drops a bomb every few seconds.

---

## 6. Multiplayer — the full picture ★

### 6.1 The big idea (read this first)

There is **no game server**. Nobody's machine simulates "the truth". Instead:

1. Both browsers generate the **identical board** from seed `7` (§3).
2. Each browser simulates **its own full game** locally (movement, bombs,
   flames, crates, powerups — all deterministic from shared inputs).
3. A tiny **relay** just forwards small messages between the two browsers:
   *"I'm at (x,z)"*, *"I dropped a bomb on cell (4,5)"*, *"I picked up the
   powerup on (6,3)"*, *"I restarted"*.
4. Each browser applies the peer's messages to its local simulation
   (remote position is **interpolated** for smoothness; remote bombs spawn
   locally and then simulate — including chains — exactly like your own).

This is sometimes called *deterministic lockstep-lite*: shared seed + event
broadcast, no authoritative simulation. It works great for 2 players on a LAN
and needs no database, accounts, or WebSocket server.

```
 Tab A (P1, "host")                     Tab B (P2, "guest")
 ─────────────────                      ──────────────────
 simulates full game                    simulates full game
      │ POST /api/state (12×/s)               │
      │  {x, z, alive, bombs[],               │
      │   pickups[], restart}                 │
      ▼                                       │
 ┌───────────┐                                │
 │   RELAY   │  ── SSE "state" fan-out ──────►│ applies to local sim:
 │ (Vite     │                                │   foe.tx/tz = x/z (lerp 12/s)
 │  middle-  │◄── POST /api/state ────────────│   spawn remote bombs,
 │  ware)    │                                │   remove picked-up powers
 └───────────┘                                ▼
```

Transport is **SSE (Server-Sent Events) downstream + plain POST upstream** —
no `ws` dependency, works through the Vite dev server, and degrades to solo
play if the relay is unreachable (every network call is fire-and-forget inside
`try/catch`).

### 6.2 The relay: `server/net.mjs`

Plain JavaScript on purpose (kept out of `tsc`, like `play-city`). Mounted as
a **Vite plugin** (`vite.config.ts` → `createBomberRelay()`), so `pnpm dev`
gives you game + relay on one port. Two endpoints:

| Endpoint | Direction | Purpose |
|---|---|---|
| `GET /api/stream?id=…` | server → browser (SSE) | opens the session; events: `hello`, `join`, `state`, `leave` |
| `POST /api/state?id=…` | browser → server | publishes this client's latest snapshot |

Walkthrough of the code:

```js
// 1. A tab opens /api/stream?id=abc → long-lived SSE response is stored:
const session = { id, res, dirty: false, last: null, lastSeen: Date.now() }
// ... newcomer gets the current roster, everyone else gets a "join":
write(res, 'hello', { t: 'hello', id, players: existing })
for (const o of sessions.values()) {
  if (o !== session) write(o.res, 'join', { t: 'join', id })
}
req.on('close', () => drop(session))   // tab closed → "leave" to the rest
```

```js
// 2. A tab POSTs {x, z, alive, bombs[], pickups[], restart} → stored, marked dirty:
s.last = JSON.parse(raw)
s.dirty = true
```

```js
// 3. Every 83ms (~12Hz) the server fans out only what changed:
const tick = setInterval(() => {
  const states = {}
  for (const s of sessions.values()) {
    if (!s.dirty) continue
    s.dirty = false
    states[s.id] = s.last
  }
  if (n > 0) for (const s of sessions.values())
    write(s.res, 'state', { t: 'state', p: states })
}, 83)
```

Notice what the server does **not** do: no rooms, no physics, no validation
beyond JSON parsing, no storage. It is a broadcast clipboard. (Compare
`play-city/server/net.mjs`, which is the same pattern with speed/clamping
validation added.)

### 6.3 The client: `src/net/room.ts`

`Room` wraps the two transports and exposes game-friendly callbacks:

```ts
export type NetState = {
  x: number; z: number; alive: boolean
  seq: number                 // last bomb sequence number (debug/catch-up)
  bombs: BombEvent[]          // NEW bombs since last POST (drained each send)
  pickups: string[]           // cells like "6,3" picked up since last POST
  restart: number              // increments on R; higher value wins
}
```

- **Identity**: `crypto`-free id (`Date.now()` + random), persisted in
  `sessionStorage`, so reloading keeps your slot.
- **Downstream**: `new EventSource('/api/stream?id=…')` with listeners for
  `hello` (how many players already here? → am I P1 or P2), `join`, `state`
  (skip your own echo, validate, forward to `onRemote`), `leave`.
- **Upstream**: `announce(get)` POSTs `get()` every 83ms. `get()` **drains**
  the `pendingBombs` / `pendingPickups` queues (`splice(0)`), so each event is
  sent exactly once.
- **Dedup**: SSE can redeliver; `seenBomb(fromId, seq)` keeps a bounded
  500-entry set of `senderId:seq` keys so a remote bomb spawns exactly once.

The golden rule of this file: **network failure must never break the game**.
Every send/receive is wrapped so exceptions just mean "still solo".

### 6.4 Wiring it into the game: `src/main.ts`

Slot assignment — first tab in the room is P1, second is P2:

```ts
room.onHello = (existing) => {
  mySlot = existing === 0 ? 1 : 2   // roster size decides, no negotiation
}
```

Applying a remote snapshot (`room.onRemote`):

```ts
const slot = remoteById.get(id)!     // the peer drives the OTHER fighter
const f = slot === 1 ? f1 : f2
f.tx = s.x; f.tz = s.z               // target for interpolation (see below)
if (!s.alive && f.alive) kill(f)     // peer died over there → die here too
for (const b of s.bombs ?? []) {     // spawn each new remote bomb locally…
  if (room.seenBomb(id, b.seq)) continue
  spawnBomb(f, b.cx, b.cz, b.range, `${id}:${b.seq}`)
}                                    // …then it fuses/chains/kills locally
for (const cell of s.pickups ?? []) {// peer grabbed it → remove my copy
  const p = powers.get(cell)
  if (p) { scene.remove(p.mesh); powers.delete(cell) }
}
if (s.restart > restartSeq) { restartSeq = s.restart; resetMatch() }
```

Remote movement smoothing — applied every frame in `online` mode (both tabs
open, no `?local2P`/`?bot`):

```ts
R.x += (R.tx - R.x) * Math.min(1, dt * 12)
R.z += (R.tz - R.z) * Math.min(1, dt * 12)
```

This is **interpolation toward the last known position** (12/s lerp): cheap,
no prediction/rollback, slightly delayed but smooth. Your own fighter is
always simulated locally with zero latency.

### 6.5 A concrete timeline (two tabs open)

```
t=0.0  A opens /api/stream → hello{players:[]} → A is P1 ("host · waiting")
t=1.2  B opens /api/stream → hello{players:[A]} → B is P2; A gets "join"
t=1.2+ both POST 12×/s; A lerps a red bean from B's positions and vice versa
t=5.0  A presses Space → dropBomb locally + pendingBombs.push({cx,cz,range,seq:7})
t=5.08 next POST carries bomb#7 → relay fans out → B spawns it (seenBomb dedups)
t=7.6  bomb#7 explodes on BOTH machines; same seed+range → same flames/crates
t=7.6  crate (6,3) breaks → rollPower(6,3) → BOTH spawn e.g. "fire" — no message!
t=9.0  B walks over (6,3) → B's POST carries pickups:["6,3"] → A deletes its copy
t=90   timer hits 0 on both → SUDDEN DEATH (each sim runs its own hazards)
t=95   A dies → A's POST carries alive:false → B's onRemote kill(f1) → "P2 WINS"
t=96   B presses R → restart:7 → A's onRemote sees 7 > 6 → resetMatch() too
```

### 6.6 Limits of this design (and what you'd change to grow)

- **One global room** — a third tab would confuse slot assignment. Next step:
  add `?room=CODE` to the stream URL and key `sessions` by room on the server.
- **No authority / anti-cheat** — a hacked client could teleport. Fine for
  friends; a competitive game would simulate on the server instead.
- **No lag compensation** — 12Hz + interpolation feels fine on LAN, rubber-bands
  on bad networks. Techniques to learn next: client prediction + server
  reconciliation, or rollback netcode (GGPO-style).
- **Clock drift** — both sims run their own timers/fuses, so long matches can
  diverge by milliseconds. The event-sourced design (bombs, pickups, restarts
  as messages) keeps the important things in sync anyway.

---

## 7. Learning paths from here

- **Three.js**: change `makePlayer()` (add a hat!), then `makeFlameCell()`
  (try a cone + smoke sprite). Read the three.js docs on `Mesh`,
  `Material`, `Geometry`, `Light` as you go.
- **Game feel**: tweak `BODY_R`, `f.speed`, fuse time `2.6`, `POWER_TTL` —
  small numbers, big differences.
- **Netcode**: open two tabs with devtools → Network → watch the `stream`
  SSE frames and the `state` POSTs live. Add a `console.log` in `onRemote`
  to see snapshots arrive.
- **Next features to try**: `?room=` codes on the relay, a third powerup
  type, kick-to-move bombs, mobile touch controls (see `play-city`'s
  `src/Input.ts` for the pattern this repo already uses).
