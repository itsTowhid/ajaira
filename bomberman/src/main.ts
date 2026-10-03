import * as THREE from 'three'
import { buildStage, makeBomb, makePlayer, makeFlameCell } from './game/stage'
import {
  cellToWorld, worldToCell, SPAWN_P1, SPAWN_P2,
  isPillar, generateCrates, COLS, ROWS,
} from './game/level'
import { rollPower, makePowerMesh, placePowerMesh, type PowerKind } from './game/powerups'
import { TouchControls } from './game/touch'
import { Room, type BombEvent } from './net/room'

const params = new URLSearchParams(location.search)
const local2P = params.has('local2P')
const botMode = params.has('bot')
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

/** Pull the camera back on narrow/portrait screens so the arena still fits. */
function fitCamera() {
  const aspect = innerWidth / innerHeight
  camera.aspect = aspect
  const k = aspect >= 1.3 ? 1 : Math.min(2.1, 1.35 / aspect)
  camera.position.copy(CAM_DIR).multiplyScalar(CAM_DIST * k)
  camera.lookAt(0, 0, -0.3)
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
}
fitCamera()

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
let restartSeq = 0
let bombSeq = 0
const pendingBombs: BombEvent[] = []
const pendingPickups: string[] = []

const banner = document.querySelector('#banner')!
const timerEl = document.querySelector('#timer')!
const stat1 = document.querySelector('#stat-p1')!
const stat2 = document.querySelector('#stat-p2')!
const netEl = document.querySelector('#net-value')!

const keys = new Set<string>()
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR' && over) { resetMatch(); restartSeq++; return }
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

/** WASD + arrows + touch bomb button, all feeding one local fighter. */
function anyMoveVec(): { dx: number; dz: number } | null {
  const dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
    (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
  const dz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
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

// ---------- net ----------
const room = new Room()
let mySlot: 1 | 2 = 1
const remoteById = new Map<string, 1 | 2>()
room.onHello = (existing) => {
  mySlot = existing === 0 ? 1 : 2
  netEl.textContent = room.status
}
room.onRemote = (id, s) => {
  if (!remoteById.has(id)) remoteById.set(id, mySlot === 1 ? 2 : 1)
  const slot = remoteById.get(id)!
  const f = slot === 1 ? f1 : f2
  f.tx = s.x; f.tz = s.z
  if (!s.alive && f.alive) kill(f)
  for (const b of s.bombs ?? []) {
    if (room.seenBomb(id, b.seq)) continue
    spawnBomb(f, b.cx, b.cz, b.range, `${id}:${b.seq}`)
  }
  for (const cell of s.pickups ?? []) {
    const p = powers.get(cell)
    if (p) { scene.remove(p.mesh); powers.delete(cell) }
  }
  if (s.restart > restartSeq) { restartSeq = s.restart; resetMatch() }
  netEl.textContent = room.status
}
room.onLeave = () => { netEl.textContent = room.status }
room.connect()
room.announce(() => {
  const m = mySlot === 1 ? f1 : f2
  return {
    x: round(m.x), z: round(m.z), alive: m.alive,
    seq: bombSeq, bombs: pendingBombs.splice(0), pickups: pendingPickups.splice(0),
    restart: restartSeq,
  }
})
const round = (v: number) => Math.round(v * 1000) / 1000

const me = () => (mySlot === 1 ? f1 : f2)
const foe = () => (mySlot === 1 ? f2 : f1)

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
  bombSeq++
  spawnBomb(f, cx, cz, f.range, `local:${bombSeq}`)
  pendingBombs.push({ cx, cz, range: f.range, seq: bombSeq })
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
      banner.innerHTML = !f1.alive && !f2.alive ? 'DRAW — press R'
        : f1.alive ? '🔵 P1 WINS — press R' : '🔴 P2 WINS — press R'
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
    pendingPickups.push(key)
  }
}

// Simple bot: random walk, occasionally bombs.
let botDir = { x: 0, z: 0 }
let botTimer = 0
let botBombTimer = 2
function botUpdate(dt: number) {
  if (!f2.alive || over) return
  botTimer -= dt; botBombTimer -= dt
  if (botTimer <= 0) {
    botTimer = 0.6 + Math.random() * 0.8
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]
    const d = dirs[Math.floor(Math.random() * dirs.length)]
    botDir = { x: d[0], z: d[1] }
  }
  if (botDir.x || botDir.z) move(f2, botDir.x, botDir.z, dt)
  if (botBombTimer <= 0) {
    botBombTimer = 2 + Math.random() * 2
    dropBomb(f2)
  }
}

// ---------- loop ----------
const clock = new THREE.Clock()
let cd1 = 0, cd2 = 0
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05)
  const now = performance.now()
  cd1 -= dt; cd2 -= dt
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

  const online = remoteById.size > 0 && !local2P && !botMode
  if (local2P) {
    const v = moveVec(false)
    if (v) move(f1, v.dx, v.dz, dt)
    if (bombPressed() && cd1 <= 0 && !keys.has('Enter')) { dropBomb(f1); cd1 = 0.3; clearBombKeys() }
    const dx2 = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0)
    const dz2 = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0)
    if (dx2 || dz2) move(f2, dx2 / Math.hypot(dx2, dz2), dz2 / Math.hypot(dx2, dz2), dt)
    if (keys.has('Enter') && cd2 <= 0) { dropBomb(f2); cd2 = 0.3; keys.delete('Enter') }
  } else if (botMode) {
    const v = anyMoveVec()
    if (v) move(f1, v.dx, v.dz, dt)
    if (bombPressed() && cd1 <= 0) { dropBomb(f1); cd1 = 0.3; clearBombKeys() }
    botUpdate(dt)
  } else if (online) {
    const L = me(), R = foe()
    const v = anyMoveVec()
    if (v) move(L, v.dx, v.dz, dt)
    if (bombPressed() && cd1 <= 0) { dropBomb(L); cd1 = 0.3; clearBombKeys() }
    if (R.alive) {
      R.x += (R.tx - R.x) * Math.min(1, dt * 12)
      R.z += (R.tz - R.z) * Math.min(1, dt * 12)
      R.mesh.position.set(R.x, Math.abs(Math.sin(now / 140)) * 0.07, R.z)
    }
  } else {
    const v = anyMoveVec()
    if (v) move(f1, v.dx, v.dz, dt)
    if (bombPressed() && cd1 <= 0) { dropBomb(f1); cd1 = 0.3; clearBombKeys() }
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
  stat2.textContent = `🔴 P2 · 💣${f2.bombs} 🔥${f2.range} 👟${f2.speed.toFixed(1)}`
  if (!netEl.textContent) netEl.textContent = room.status

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
addEventListener('resize', fitCamera)
addEventListener('orientationchange', () => setTimeout(fitCamera, 100))
frame()
