import * as THREE from 'three'
import { buildStage, makeBomb, makePlayer, makeFlameCell } from './game/stage'
import {
  cellToWorld, worldToCell, SPAWN_P1, SPAWN_P2,
  isPillar, generateCrates, COLS, ROWS,
} from './game/level'
import { rollPower, makePowerMesh, placePowerMesh, type PowerKind } from './game/powerups'
import { TouchControls } from './game/touch'

const SEED = 7
const MATCH_SECS = 90

// ---------- renderer / scene ----------
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8ecae6)
scene.fog = new THREE.Fog(0xa9d6e5, 34, 70)

// soft sky glow backdrop (big gradient dome, cheap)
{
  const c = document.createElement('canvas')
  c.width = 4; c.height = 128
  const ctx = c.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, '#5aa9e6')
  grad.addColorStop(0.6, '#8ecae6')
  grad.addColorStop(1, '#d8f3dc')
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 4, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
  )
  dome.position.y = -4
  scene.add(dome)
  // distant toy hills
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x74c69d })
  for (const [hx, hz, hr] of [[-22, -18, 9], [20, -22, 11], [0, -28, 13], [-26, 8, 8], [26, 10, 8]] as const) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(hr, 20, 14), hillMat)
    hill.scale.y = 0.35
    hill.position.set(hx, -1, hz)
    scene.add(hill)
  }
}

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 220)
const CAM_DIR = new THREE.Vector3(0, 14.5, 9.5).normalize()
const CAM_DIST = new THREE.Vector3(0, 14.5, 9.5).length()
/** View pivot; slides on portrait so the zoomed view follows the action. */
const camTarget = new THREE.Vector3(0, 0, -0.3)

function resize() {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
}
addEventListener('resize', resize)

/**
 * Landscape fits the whole 13x11 board (k=1). Fitting the width on a portrait
 * phone needs ~2.1x distance, which shrank the board to a ~30%-height strip —
 * so portrait instead zooms to k<=1.6 (~34% bigger tiles, ~9-10 of 13 columns
 * visible) and slides horizontally to follow the local fighter, clamped so the
 * view never slides off the board. Desktop framing is pixel-identical to before.
 */
function updateCamera(dt: number, focusX: number) {
  const aspect = innerWidth / innerHeight
  const portrait = aspect < 1.3
  const k = portrait ? Math.min(1.6, 1.3 / aspect) : 1
  // Visible half-width at k=1.6 is ~4.85 tiles vs the board's 6.5, so the
  // pivot may stray at most ~1.65 tiles from centre before showing void.
  const wantX = portrait ? THREE.MathUtils.clamp(focusX, -1.65, 1.65) : 0
  camTarget.x += (wantX - camTarget.x) * Math.min(1, dt * 5)
  camera.position.copy(CAM_DIR).multiplyScalar(CAM_DIST * k).add(camTarget)
  camera.lookAt(camTarget)
}
updateCamera(1, 0)

scene.add(new THREE.HemisphereLight(0xcdeaff, 0x5f7038, 0.95))
const sun = new THREE.DirectionalLight(0xfff1d0, 2.4)
sun.position.set(9, 15, 7)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -10; sun.shadow.camera.right = 10
sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10
sun.shadow.camera.far = 50
sun.shadow.bias = -0.0006
scene.add(sun)
const fill = new THREE.DirectionalLight(0xbde0fe, 0.55)
fill.position.set(-8, 6, -9)
scene.add(fill)
// reusable explosion flash (one light, moved to latest blast)
const flash = new THREE.PointLight(0xffb703, 0, 14, 1.8)
scene.add(flash)

// ---------- state ----------
type Fighter = {
  mesh: THREE.Group; x: number; z: number
  alive: boolean; bombs: number; range: number; speed: number
  tx: number; tz: number
  /** bomb cells the fighter is standing on and may walk out of (classic rule) */
  pass: Set<string>
}
type Bomb = { cx: number; cz: number; t: number; owner: Fighter; mesh: THREE.Group; range: number; key: string }

let stage = buildStage(SEED)
scene.add(stage)
let crates = generateCrates(SEED)
const powers = new Map<string, { kind: PowerKind; mesh: THREE.Group; t: number }>()
// Unpicked rewards fade away so the board doesn't fill up.
const POWER_TTL = 12
const POWER_BLINK_AT = 3
const bombs: Bomb[] = []
const flames: { mesh: THREE.Group; t: number; hot: boolean }[] = []
const dying: { f: Fighter; t: number }[] = []

const s1 = cellToWorld(SPAWN_P1.cx, SPAWN_P1.cz)
const s2 = cellToWorld(SPAWN_P2.cx, SPAWN_P2.cz)
const f1: Fighter = { mesh: makePlayer(0x3b82f6), x: s1.x, z: s1.z, alive: true, bombs: 1, range: 2, speed: 4, tx: s1.x, tz: s1.z, pass: new Set() }
const f2: Fighter = { mesh: makePlayer(0xef4444), x: s2.x, z: s2.z, alive: true, bombs: 1, range: 2, speed: 4, tx: s2.x, tz: s2.z, pass: new Set() }
f1.mesh.position.set(s1.x, 0, s1.z)
f2.mesh.position.set(s2.x, 0, s2.z)
scene.add(f1.mesh, f2.mesh)

let timeLeft = MATCH_SECS
let suddenDeath = false
let suddenTimer = 0
let over = false
const banner = document.querySelector('#banner')!
const timerEl = document.querySelector('#timer')!
const stat1 = document.querySelector('#stat-p1')!
const stat2 = document.querySelector('#stat-p2')!

const keys = new Set<string>()
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && over) { resetMatch(); return }
  keys.add(e.code)
})
addEventListener('keyup', (e) => keys.delete(e.code))
addEventListener('blur', () => keys.clear()) // no stuck keys on tab switch

const touch = new TouchControls()

/** Keyboard (WASD or arrows) movement, else joystick if deflected. */
function moveVec(useArrows: boolean): { dx: number; dz: number } | null {
  const L = useArrows ? 'ArrowLeft' : 'KeyA'
  const R = useArrows ? 'ArrowRight' : 'KeyD'
  const U = useArrows ? 'ArrowUp' : 'KeyW'
  const D = useArrows ? 'ArrowDown' : 'KeyS'
  const dx = (keys.has(R) ? 1 : 0) - (keys.has(L) ? 1 : 0)
  const dz = (keys.has(D) ? 1 : 0) - (keys.has(U) ? 1 : 0)
  if (dx || dz) {
    const len = Math.hypot(dx, dz)
    return { dx: dx / len, dz: dz / len }
  }
  if (touch.active) return { dx: touch.vec.x, dz: touch.vec.z }
  return null
}

function bombPressed(): boolean {
  if (touch.consumeBomb()) return true
  return keys.has('Space') || keys.has('Enter')
}

function clearBombKeys() {
  keys.delete('Space')
  keys.delete('Enter')
}

const me = () => f1

// ---------- gameplay ----------
// Player body radius in world units (tile = 1). Circle-vs-grid collision
// keeps beans from sinking into walls instead of stopping at cell centers.
const BODY_R = 0.3

function solidCell(cx: number, cz: number, pass?: Set<string>): boolean {
  if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS) return true
  if (isPillar(cx, cz)) return true
  if (crates.has(`${cx},${cz}`)) return true
  // A fighter may always walk OUT of a bomb cell they are standing on,
  // but can never walk back INTO one.
  if (pass?.has(`${cx},${cz}`)) return false
  return bombs.some((b) => b.cx === cx && b.cz === cz)
}

/** Does the player circle overlap cell (cx,cz)? */
function circleOverlapsCell(x: number, z: number, cx: number, cz: number): boolean {
  const { x: wx, z: wz } = cellToWorld(cx, cz)
  return Math.abs(x - wx) < 0.5 + BODY_R && Math.abs(z - wz) < 0.5 + BODY_R
}

/** True if a circle at (x,z) overlaps any solid cell. */
function hitsSolid(x: number, z: number, pass?: Set<string>): boolean {
  // Cells are centered on integers, so cell index = floor(coord + 0.5).
  const x0 = x - BODY_R + (COLS - 1) / 2, x1 = x + BODY_R + (COLS - 1) / 2
  const z0 = z - BODY_R + (ROWS - 1) / 2, z1 = z + BODY_R + (ROWS - 1) / 2
  for (let cz = Math.floor(z0 + 0.5); cz <= Math.floor(z1 + 0.5); cz++) {
    for (let cx = Math.floor(x0 + 0.5); cx <= Math.floor(x1 + 0.5); cx++) {
      if (solidCell(cx, cz, pass)) return true
    }
  }
  return false
}

function spawnBomb(f: Fighter, cx: number, cz: number, range: number, key: string) {
  const { x, z } = cellToWorld(cx, cz)
  const mesh = makeBomb()
  mesh.position.set(x, 0, z)
  scene.add(mesh)
  bombs.push({ cx, cz, t: 2.6, owner: f, mesh, range, key })
}

function dropBomb(f: Fighter) {
  const { cx, cz } = worldToCell(f.x, f.z)
  if (bombs.filter((b) => b.owner === f).length >= f.bombs) return
  if (bombs.some((b) => b.cx === cx && b.cz === cz)) return
  // don't trap yourself: need a free neighbour to escape to
  const esc: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  if (!esc.some(([dx, dz]) => !solidCell(cx + dx, cz + dz))) return
  spawnBomb(f, cx, cz, f.range, `local`)
}

function explode(b: Bomb) {
  // Remove first so chain reactions can't re-trigger the same bomb.
  const at = bombs.indexOf(b)
  if (at >= 0) bombs.splice(at, 1)
  scene.remove(b.mesh)
  const cells: [number, number][] = [[b.cx, b.cz]]
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    for (let i = 1; i <= b.range; i++) {
      const ccx = b.cx + dx * i, ccz = b.cz + dz * i
      if (ccx < 0 || ccz < 0 || ccx >= COLS || ccz >= ROWS || isPillar(ccx, ccz)) break
      cells.push([ccx, ccz])
      if (crates.has(`${ccx},${ccz}`)) {
        crates.delete(`${ccx},${ccz}`)
        stage.children.find((c) => c.userData.cell === `${ccx},${ccz}`)?.removeFromParent()
        const kind = rollPower(ccx, ccz, SEED)
        if (kind) {
          const mesh = makePowerMesh(kind)
          placePowerMesh(mesh, ccx, ccz)
          scene.add(mesh)
          powers.set(`${ccx},${ccz}`, { kind, mesh, t: POWER_TTL })
        }
        break
      }
    }
  }
  for (const [cx, cz] of cells) {
    const { x, z } = cellToWorld(cx, cz)
    const m = makeFlameCell()
    m.position.set(x, 0, z)
    m.scale.setScalar(0.2)
    scene.add(m)
    flames.push({ mesh: m, t: 0.55, hot: false })
    for (const f of [f1, f2]) {
      if (!f.alive) continue
      const fc = worldToCell(f.x, f.z)
      if (fc.cx === cx && fc.cz === cz) kill(f)
    }
  }
  // Chain reaction: any other live bomb caught in the blast goes off too.
  const chained = bombs.filter((o) => cells.some(([cx, cz]) => o.cx === cx && o.cz === cz))
  for (const o of chained) explode(o)
  const { x, z } = cellToWorld(b.cx, b.cz)
  flash.position.set(x, 1.6, z)
  flash.intensity = 60
}

function kill(f: Fighter) {
  if (!f.alive) return
  f.alive = false
  dying.push({ f, t: 0.28 })
  endCheck()
}

function endCheck() {
  if (over) return
  if (!f1.alive || !f2.alive || timeLeft <= 0 && suddenDeath) {
    if (!f1.alive || !f2.alive) {
      over = true
      const text = !f1.alive && !f2.alive ? 'DRAW' : f1.alive ? '🔵 YOU WIN' : '🔴 CPU WINS'
      // Tap/click target inside the banner — "press R" means nothing on mobile.
      banner.innerHTML = `${text}<button id="banner-restart" class="banner__btn" type="button">Play again</button>`
      banner.querySelector<HTMLButtonElement>('#banner-restart')
        ?.addEventListener('click', () => { if (over) resetMatch() })
      banner.classList.remove('hidden')
    }
    return
  }
  if (timeLeft <= 0 && !suddenDeath) {
    suddenDeath = true
    banner.textContent = '☠️ SUDDEN DEATH'
    banner.classList.remove('hidden')
    setTimeout(() => { if (!over) banner.classList.add('hidden') }, 2000)
  }
}

function resetMatch() {
  scene.remove(stage)
  for (const b of bombs) scene.remove(b.mesh)
  for (const f of flames) scene.remove(f.mesh)
  for (const [, p] of powers) scene.remove(p.mesh)
  bombs.length = 0; flames.length = 0; powers.clear(); dying.length = 0
  stage = buildStage(SEED)
  scene.add(stage)
  crates = generateCrates(SEED)
  for (const [f, s] of [[f1, s1], [f2, s2]] as const) {
    f.x = s.x; f.z = s.z; f.tx = s.x; f.tz = s.z
    f.alive = true; f.bombs = 1; f.range = 2; f.speed = 4
    f.pass.clear()
    f.mesh.visible = true
    f.mesh.scale.setScalar(1)
    f.mesh.position.set(s.x, 0, s.z)
  }
  timeLeft = MATCH_SECS; suddenDeath = false; suddenTimer = 0; over = false
  flash.intensity = 0
  banner.classList.add('hidden')
}

function move(f: Fighter, dx: number, dz: number, dt: number) {
  if (!f.alive || over) return
  // Refresh walk-out permission: a bomb cell stays passable while our
  // circle still overlaps it. Once fully out it becomes solid again.
  const cur = worldToCell(f.x, f.z)
  const curKey = `${cur.cx},${cur.cz}`
  if (bombs.some((b) => `${b.cx},${b.cz}` === curKey)) f.pass.add(curKey)
  for (const k of [...f.pass]) {
    const [pcx, pcz] = k.split(',').map(Number)
    const gone = !bombs.some((b) => `${b.cx},${b.cz}` === k)
    if (gone || !circleOverlapsCell(f.x, f.z, pcx, pcz)) f.pass.delete(k)
  }
  // Circle collision per axis so corners slide and bodies stop at walls
  // instead of sinking halfway into them.
  const nx = f.x + dx * f.speed * dt
  if (!hitsSolid(nx, f.z, f.pass)) f.x = nx
  const nz = f.z + dz * f.speed * dt
  if (!hitsSolid(f.x, nz, f.pass)) f.z = nz
  f.mesh.position.set(f.x, Math.abs(Math.sin(performance.now() / 140)) * 0.07, f.z)
  f.mesh.rotation.y = Math.atan2(dx, dz)
  const cell = worldToCell(f.x, f.z)
  const key = `${cell.cx},${cell.cz}`
  const p = powers.get(key)
  if (p) {
    if (p.kind === 'bomb') f.bombs = Math.min(6, f.bombs + 1)
    if (p.kind === 'fire') f.range = Math.min(6, f.range + 1)
    if (p.kind === 'speed') f.speed = Math.min(7, f.speed + 0.7)
    scene.remove(p.mesh)
    powers.delete(key)
  }
}

// ---------- CPU brain ----------
// Belief model: every live bomb paints its blast footprint with its fuse time.
// A cell is enterable only if there is ample fuse left to also walk back out.
// The bot re-plans at ~6 Hz: flee if standing in danger, else bomb a good spot
// (crates/player in the blast, escape verified) or walk toward crates/power-ups.
let botDir = { x: 0, z: 0 }
let botBombTimer = 1.5
let botThink = 0
let botGoal: { cx: number; cz: number } | null = null

function botCell(f: Fighter): { cx: number; cz: number } {
  return worldToCell(f.x, f.z)
}

/** Fuse time of the most urgent bomb covering each cell. */
function dangerMap(): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of bombs) {
    const cells: [number, number][] = [[b.cx, b.cz]]
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let i = 1; i <= b.range; i++) {
        const cx = b.cx + dx * i, cz = b.cz + dz * i
        if (cx < 0 || cz < 0 || cx >= COLS || cz >= ROWS || isPillar(cx, cz)) break
        cells.push([cx, cz])
        if (crates.has(`${cx},${cz}`)) break
      }
    }
    for (const [cx, cz] of cells) {
      const key = `${cx},${cz}`
      const prev = map.get(key)
      if (prev === undefined || b.t < prev) map.set(key, b.t)
    }
  }
  return map
}

const BOT_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/**
 * BFS from `start` across cells that are safe to enter (solid cells excluded,
 * dangerous cells only when their fuse comfortably exceeds walk-in time).
 * Returns hop distance per cell and, for the start cell's neighbours, which
 * direction begins the shortest path there.
 */
function botBfs(start: { cx: number; cz: number }, danger: Map<string, number>) {
  const dist = new Map<string, number>()
  const first = new Map<string, [number, number]>()
  const queue: { cx: number; cz: number }[] = [start]
  dist.set(`${start.cx},${start.cz}`, 0)
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!
    const curDist = dist.get(`${cur.cx},${cur.cz}`)!
    for (const [dx, dz] of BOT_DIRS) {
      const nx = cur.cx + dx, nz = cur.cz + dz
      const key = `${nx},${nz}`
      if (dist.has(key)) continue
      if (nx < 0 || nz < 0 || nx >= COLS || nz >= ROWS) continue
      if (solidCell(nx, nz)) continue
      const dn = danger.get(key)
      // Entering danger needs fuse >= walk-in + walk-out + margin.
      if (dn !== undefined && dn < 0.55 * (curDist + 2) + 0.35) continue
      dist.set(key, curDist + 1)
      first.set(key, curDist === 0 ? [dx, dz] : first.get(`${cur.cx},${cur.cz}`)!)
      queue.push({ cx: nx, cz: nz })
    }
  }
  return { dist, first }
}

/** Value of bombing from (cx,cz): crates/player in the blast lanes. */
function bombSpotScore(cx: number, cz: number, range: number): number {
  let score = 0
  const pc = f1.alive ? botCell(f1) : null
  for (const [dx, dz] of BOT_DIRS) {
    for (let i = 1; i <= range; i++) {
      const tx = cx + dx * i, tz = cz + dz * i
      if (tx < 0 || tz < 0 || tx >= COLS || tz >= ROWS || isPillar(tx, tz)) break
      if (crates.has(`${tx},${tz}`)) { score += 10 - i; break }
      if (pc && tx === pc.cx && tz === pc.cz) score += 16 - i * 2
    }
  }
  return score
}

/** Would we survive dropping a bomb at (cx,cz) right now? */
function hasEscapeAfterBomb(cx: number, cz: number, range: number, danger: Map<string, number>): boolean {
  const imagined = new Map(danger)
  imagined.set(`${cx},${cz}`, 2.6)
  for (const [dx, dz] of BOT_DIRS) {
    for (let i = 1; i <= range; i++) {
      const tx = cx + dx * i, tz = cz + dz * i
      if (tx < 0 || tz < 0 || tx >= COLS || tz >= ROWS || isPillar(tx, tz)) break
      imagined.set(`${tx},${tz}`, 2.6)
      if (crates.has(`${tx},${tz}`)) break
    }
  }
  const { dist } = botBfs({ cx, cz }, imagined)
  // Some reachable cell must be outside every footprint.
  for (const [key] of dist) if (!imagined.has(key)) return true
  return false
}

function botUpdate(dt: number) {
  if (!f2.alive || over) return
  botThink -= dt
  if (botBombTimer > 0) botBombTimer -= dt

  const me = botCell(f2)
  const danger = dangerMap()
  const goalKey = botGoal ? `${botGoal.cx},${botGoal.cz}` : ''

  // Re-plan at ~6 Hz, or immediately when the goal went dangerous/blocked.
  if (botThink > 0 && botGoal && !danger.has(goalKey) && !solidCell(botGoal.cx, botGoal.cz)) {
    if (botDir.x || botDir.z) move(f2, botDir.x, botDir.z, dt)
    return
  }
  botThink = 0.16

  const inDanger = danger.has(`${me.cx},${me.cz}`)
  let goal: { cx: number; cz: number } | null = null
  let step: [number, number] | undefined

  if (inDanger) {
    // Flee to the nearest cell outside every blast footprint.
    const { dist, first } = botBfs(me, danger)
    let fleeKey: string | null = null
    let fleeDist = Infinity
    for (const [key, d] of dist) {
      if (danger.has(key)) continue
      if (d < fleeDist) { fleeDist = d; fleeKey = key }
    }
    if (fleeKey) {
      const [gcx, gcz] = fleeKey.split(',').map(Number)
      goal = { cx: gcx, cz: gcz }
      step = first.get(fleeKey)
    }
  } else {
    // Safe: bomb here if worthwhile and survivable, else walk to the best target.
    const bombHere = f2.bombs > 0 && botBombTimer <= 0 && bombSpotScore(me.cx, me.cz, f2.range) >= 8
      && hasEscapeAfterBomb(me.cx, me.cz, f2.range, danger)
    if (bombHere) {
      dropBomb(f2)
      botBombTimer = 1.4 + Math.random() * 0.8
      // Immediately flee our own bomb.
      const { dist, first } = botBfs(me, dangerMap())
      let fleeKey: string | null = null
      let fleeDist = Infinity
      for (const [key, d] of dist) {
        if (dangerMap().has(key)) continue
        if (d < fleeDist) { fleeDist = d; fleeKey = key }
      }
      if (fleeKey) {
        const [gcx, gcz] = fleeKey.split(',').map(Number)
        goal = { cx: gcx, cz: gcz }
        step = first.get(fleeKey)
      }
    } else {
      const { dist, first } = botBfs(me, danger)
      let bestKey: string | null = null
      let bestScore = -Infinity
      for (const [key, d] of dist) {
        if (d > 9) continue
        const [cx, cz] = key.split(',').map(Number)
        let s = -d * 0.8
        if (powers.has(key)) s += 14
        // Reward standing next to crates (a future bombing perch).
        for (const [ax, az] of BOT_DIRS) if (crates.has(`${cx + ax},${cz + az}`)) { s += 2.5; break }
        if (f1.alive) {
          const pc = botCell(f1)
          s += Math.max(0, 6 - (Math.abs(cx - pc.cx) + Math.abs(cz - pc.cz)))
        }
        if (s > bestScore) { bestScore = s; bestKey = key }
      }
      if (bestKey) {
        const [gcx, gcz] = bestKey.split(',').map(Number)
        goal = { cx: gcx, cz: gcz }
        step = first.get(bestKey)
      }
    }
  }

  botGoal = goal
  botDir = step ? { x: step[0], z: step[1] } : { x: 0, z: 0 }
  if (botDir.x || botDir.z) move(f2, botDir.x, botDir.z, dt)
}

// ---------- loop ----------
const clock = new THREE.Clock()
let cd1 = 0
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const now = performance.now()
  cd1 -= dt
  flash.intensity = Math.max(0, flash.intensity - dt * 160)

  if (!over) {
    timeLeft -= dt
    if (timeLeft <= 0) { timeLeft = 0; endCheck() }
    if (suddenDeath) {
      suddenTimer -= dt
      if (suddenTimer <= 0) {
        suddenTimer = 1.2
        const free: [number, number][] = []
        for (let cz = 1; cz < ROWS - 1; cz++)
          for (let cx = 1; cx < COLS - 1; cx++)
            if (!isPillar(cx, cz) && !crates.has(`${cx},${cz}`)) free.push([cx, cz])
        const pick = free[Math.floor(Math.random() * free.length)]
        if (pick) {
          const { x, z } = cellToWorld(pick[0], pick[1])
          const m = makeFlameCell(true)
          m.position.set(x, 0, z)
          m.scale.setScalar(0.2)
          scene.add(m)
          flames.push({ mesh: m, t: 0.9, hot: true })
          flash.position.set(x, 1.6, z)
          flash.intensity = 40
          for (const f of [f1, f2]) {
            if (!f.alive) continue
            const fc = worldToCell(f.x, f.z)
            if (fc.cx === pick[0] && fc.cz === pick[1]) kill(f)
          }
        }
      }
    }
  }

  // Single player vs the bot, always.
  {
    const v = moveVec(false)
    if (v) move(f1, v.dx, v.dz, dt)
    if (bombPressed() && cd1 <= 0) { dropBomb(f1); cd1 = 0.3; clearBombKeys() }
    botUpdate(dt)
  }

  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i]
    if (!b) continue
    b.t -= dt
    const pulse = 1 + Math.sin(now / 110) * (b.t < 0.8 ? 0.14 : 0.05)
    b.mesh.scale.setScalar(pulse)
    const spark = b.mesh.getObjectByName('spark')
    if (spark) spark.scale.setScalar(1 + Math.sin(now / 40) * 0.35)
    // explode() removes itself + any chained bombs, so re-check liveness.
    if (b.t <= 0 && bombs.includes(b)) { explode(b); endCheck() }
  }
  for (let i = flames.length - 1; i >= 0; i--) {
    const fl = flames[i]
    fl.t -= dt
    const life = fl.hot ? 0.9 : 0.55
    const k = Math.max(0.01, fl.t / life)
    fl.mesh.scale.set(0.4 + 0.6 * (1 - k) + 0.5 * k, 0.5 + 0.7 * k, 0.4 + 0.6 * (1 - k) + 0.5 * k)
    if (fl.t <= 0) { scene.remove(fl.mesh); flames.splice(i, 1) }
  }
  for (let i = dying.length - 1; i >= 0; i--) {
    const d = dying[i]
    d.t -= dt
    d.f.mesh.scale.setScalar(Math.max(0.01, d.t / 0.28))
    d.f.mesh.rotation.y += dt * 12
    if (d.t <= 0) { d.f.mesh.visible = false; dying.splice(i, 1) }
  }
  for (const [key, p] of powers) {
    p.t -= dt
    if (p.t <= 0) { scene.remove(p.mesh); powers.delete(key); continue }
    p.mesh.rotation.y += dt * 1.6
    p.mesh.position.y = Math.sin(now / 320) * 0.05
    // blink as a pickup warning during the last seconds
    p.mesh.visible = p.t > POWER_BLINK_AT || Math.sin(now / 130) > -0.2
  }

  const mm = Math.floor(Math.max(0, timeLeft) / 60)
  const ss = Math.floor(Math.max(0, timeLeft) % 60).toString().padStart(2, '0')
  timerEl.textContent = suddenDeath ? `☠️ ${mm}:${ss}` : `${mm}:${ss}`
  timerEl.classList.toggle('timer--danger', suddenDeath || timeLeft < 15)
  stat1.textContent = `🔵 P1 · 💣${f1.bombs} 🔥${f1.range} 👟${f1.speed.toFixed(1)}`
  stat2.textContent = `🔴 CPU · 💣${f2.bombs} 🔥${f2.range} 👟${f2.speed.toFixed(1)}`

  // Portrait slides the view to follow the local fighter; landscape is fixed.
  updateCamera(dt, me().x)

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
frame()
