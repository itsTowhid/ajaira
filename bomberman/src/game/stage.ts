import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { COLS, ROWS, cellToWorld, generateCrates, isPillar } from './level'

export const PALETTE = {
  grassA: 0xa9dd6e,
  grassB: 0x97d258,
  soil: 0x6b4a2b,
  soilDark: 0x54371f,
  wood: 0x9a6a3b,
  woodDark: 0x6e4a26,
  stone: 0xdfe1e8,
  stoneDark: 0xa8adbb,
  moss: 0x5fae4e,
  crate: 0xe8a34e,
  cream: 0xfff6da,
}

// ---------- procedural canvas textures ----------
function canvasTex(size: number, paint: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  paint(c.getContext('2d')!, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function speckle(ctx: CanvasRenderingContext2D, s: number, n: number, colors: string[], rMin = 1, rMax = 2.5) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0]
    ctx.globalAlpha = 0.25 + Math.random() * 0.3
    const r = rMin + Math.random() * (rMax - rMin)
    ctx.beginPath()
    ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

let grassA: THREE.CanvasTexture | null = null
let grassB: THREE.CanvasTexture | null = null
let crateT: THREE.CanvasTexture | null = null
let woodT: THREE.CanvasTexture | null = null
let stoneT: THREE.CanvasTexture | null = null

function textures() {
  if (!grassA) {
    grassA = canvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#a9dd6e'; ctx.fillRect(0, 0, s, s)
      speckle(ctx, s, 90, ['#8fc451', '#c2e98c', '#7fae45'])
    })
    grassB = canvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#97d258'; ctx.fillRect(0, 0, s, s)
      speckle(ctx, s, 90, ['#7fae45', '#abd97a', '#6f9c3c'])
    })
    crateT = canvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#e8a34e'; ctx.fillRect(0, 0, s, s)
      // planks
      ctx.strokeStyle = 'rgba(140,85,25,.55)'; ctx.lineWidth = 3
      for (const y of [s / 3, (2 * s) / 3]) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke()
      }
      // frame
      ctx.strokeStyle = '#9c5f1e'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, s - 10, s - 10)
      // X brace
      ctx.strokeStyle = '#c97e2b'; ctx.lineWidth = 12
      ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(s - 10, s - 10); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(s - 10, 10); ctx.lineTo(10, s - 10); ctx.stroke()
      ctx.strokeStyle = 'rgba(255,240,200,.35)'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(12, 20); ctx.lineTo(s - 20, s - 12); ctx.stroke()
      // nails
      ctx.fillStyle = '#6e3f12'
      for (const [x, y] of [[16, 16], [s - 16, 16], [16, s - 16], [s - 16, s - 16]] as const) {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill()
      }
      speckle(ctx, s, 30, ['#d18a35', '#f4c078'])
    })
    woodT = canvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#9a6a3b'; ctx.fillRect(0, 0, s, s)
      for (let x = 0; x < s; x += 9) {
        ctx.strokeStyle = `rgba(80,50,20,${0.18 + (x % 27 === 0 ? 0.2 : 0)})`
        ctx.lineWidth = x % 27 === 0 ? 4 : 2
        ctx.beginPath(); ctx.moveTo(x, 0)
        ctx.bezierCurveTo(x + 6, s / 3, x - 6, (2 * s) / 3, x + 3, s)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255,230,180,.12)'; ctx.fillRect(0, 0, s, 10)
    })
    stoneT = canvasTex(128, (ctx, s) => {
      ctx.fillStyle = '#dfe1e8'; ctx.fillRect(0, 0, s, s)
      ctx.strokeStyle = '#a8adbb'; ctx.lineWidth = 4
      ctx.strokeRect(4, 4, s - 8, s - 8)
      ctx.beginPath(); ctx.moveTo(4, s / 2); ctx.lineTo(s - 4, s / 2); ctx.stroke()
      speckle(ctx, s, 60, ['#c4c8d4', '#f2f3f7', '#9aa0ae'])
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(8, 8, s - 16, 8)
    })
  }
  return { grassA, grassB, crateT, woodT, stoneT }
}

// seeded jitter so both net peers place identical crates
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- stage ----------
const tileGeo = new RoundedBoxGeometry(1, 0.24, 1, 2, 0.05)
const blockGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.09)
const crateGeo = new RoundedBoxGeometry(1, 0.86, 1, 2, 0.09)

export function buildStage(seed = 7): THREE.Group {
  const { grassA: gA, grassB: gB, crateT: cT, woodT: wT, stoneT: sT } = textures()
  const group = new THREE.Group()
  const rand = mulberry(seed * 1000 + 11)
  const crates = generateCrates(seed)

  // diorama base: soil platform under the arena
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(COLS + 1.6, 1.2, ROWS + 1.6, 3, 0.3),
    new THREE.MeshStandardMaterial({ color: PALETTE.soil, roughness: 0.95 }),
  )
  base.position.y = -0.72
  base.receiveShadow = true
  group.add(base)
  const baseTrim = new THREE.Mesh(
    new RoundedBoxGeometry(COLS + 1.7, 0.22, ROWS + 1.7, 2, 0.1),
    new THREE.MeshStandardMaterial({ color: PALETTE.soilDark, roughness: 1 }),
  )
  baseTrim.position.y = -1.28
  group.add(baseTrim)

  const floorA = new THREE.MeshStandardMaterial({ map: gA, roughness: 0.9 })
  const floorB = new THREE.MeshStandardMaterial({ map: gB, roughness: 0.9 })
  const wallMat = new THREE.MeshStandardMaterial({ map: wT, roughness: 0.8 })
  const stoneMat = new THREE.MeshStandardMaterial({ map: sT, roughness: 0.85 })
  const mossMat = new THREE.MeshStandardMaterial({ color: PALETTE.moss, roughness: 0.9 })
  const crateMat = new THREE.MeshStandardMaterial({ map: cT, roughness: 0.75 })

  for (let cz = 0; cz < ROWS; cz++) {
    for (let cx = 0; cx < COLS; cx++) {
      const { x, z } = cellToWorld(cx, cz)
      const tile = new THREE.Mesh(tileGeo, (cx + cz) % 2 === 0 ? floorA : floorB)
      tile.position.set(x, -0.12, z)
      tile.receiveShadow = true
      group.add(tile)
    }
  }

  const mossGeo = new RoundedBoxGeometry(0.7, 0.12, 0.7, 2, 0.05)
  for (let cz = 0; cz < ROWS; cz++) {
    for (let cx = 0; cx < COLS; cx++) {
      const key = `${cx},${cz}`
      const pillar = isPillar(cx, cz)
      const crate = crates.has(key) && !pillar
      if (!pillar && !crate) continue
      const { x, z } = cellToWorld(cx, cz)
      if (crate) {
        const m = new THREE.Mesh(crateGeo, crateMat)
        m.position.set(x, 0.43, z)
        m.rotation.y = (rand() - 0.5) * 0.09
        const s = 0.96 + rand() * 0.06
        m.scale.set(s, 1, s)
        m.castShadow = m.receiveShadow = true
        m.userData.cell = key
        group.add(m)
        continue
      }
      const border = cx === 0 || cz === 0 || cx === COLS - 1 || cz === ROWS - 1
      const h = border ? 1.15 : 0.95
      const m = new THREE.Mesh(blockGeo, border ? wallMat : stoneMat)
      m.scale.y = h
      m.position.set(x, h / 2, z)
      m.castShadow = m.receiveShadow = true
      m.userData.cell = key
      group.add(m)
      if (!border) {
        // moss cap on inner pillars
        const cap = new THREE.Mesh(mossGeo, mossMat)
        cap.position.set(x + 0.08, h + 0.02, z - 0.06)
        cap.rotation.y = rand() * Math.PI
        group.add(cap)
      } else {
        // wood cap rail on border walls
        const rail = new THREE.Mesh(
          new RoundedBoxGeometry(1.04, 0.14, 1.04, 2, 0.06),
          new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.85 }),
        )
        rail.position.set(x, h + 0.05, z)
        rail.castShadow = true
        group.add(rail)
      }
    }
  }
  return group
}

// ---------- players: glossy toy beans ----------
function shade(hex: number, f: number): number {
  const c = new THREE.Color(hex)
  c.multiplyScalar(f)
  return Number(`0x${c.getHexString()}`)
}

export function makePlayer(color: number): THREE.Group {
  const g = new THREE.Group()
  const dark = shade(color, 0.55)

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 24),
    new THREE.MeshBasicMaterial({ color: 0x1d2b12, transparent: true, opacity: 0.28 }),
  )
  blob.rotation.x = -Math.PI / 2
  blob.position.y = 0.015
  g.add(blob)

  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.34, 0.1, 24),
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6 }),
  )
  ring.position.y = 0.05
  g.add(ring)

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.05 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.3, 8, 20), bodyMat)
  body.position.y = 0.52
  body.castShadow = true
  g.add(body)

  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 16, 12),
    new THREE.MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.6 }),
  )
  belly.scale.set(1, 1.25, 0.55)
  belly.position.set(0, 0.44, 0.2)
  g.add(belly)

  const white = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const pupil = new THREE.MeshBasicMaterial({ color: 0x141414 })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), white)
    eye.position.set(side * 0.11, 0.66, 0.21)
    const pup = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), pupil)
    pup.position.set(side * 0.11, 0.66, 0.275)
    const blush = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff9db0, transparent: true, opacity: 0.85 }),
    )
    blush.scale.set(1, 0.7, 0.4)
    blush.position.set(side * 0.2, 0.55, 0.18)
    g.add(eye, pup, blush)
  }
  // highlight dot on head
  const shine = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
  )
  shine.position.set(-0.13, 0.82, 0.14)
  g.add(shine)

  // stubby feet
  const footGeo = new RoundedBoxGeometry(0.16, 0.12, 0.22, 2, 0.05)
  const footMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.7 })
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(footGeo, footMat)
    foot.position.set(side * 0.13, 0.1, 0.03)
    foot.castShadow = true
    g.add(foot)
  }
  return g
}

// ---------- bombs: glossy + fuse + spark ----------
export function makeBomb(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 24, 18),
    new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.18, metalness: 0.35 }),
  )
  body.position.y = 0.32
  body.castShadow = true
  g.add(body)

  const gloss = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  )
  gloss.position.set(-0.11, 0.44, 0.2)
  gloss.scale.set(1, 1.3, 0.5)
  g.add(gloss)

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.09, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: 0x9c5f1e, roughness: 0.7 }),
  )
  cap.position.y = 0.62
  g.add(cap)

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0.66, 0),
    new THREE.Vector3(0.12, 0.82, 0),
    new THREE.Vector3(0.2, 0.76, 0),
  )
  const fuse = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 8, 0.02, 6),
    new THREE.MeshStandardMaterial({ color: 0xd9b382, roughness: 0.9 }),
  )
  g.add(fuse)

  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc93d }),
  )
  spark.position.set(0.2, 0.76, 0)
  spark.name = 'spark'
  g.add(spark)
  return g
}

// ---------- flames: layered toy fire ----------
const flameOuterGeo = new RoundedBoxGeometry(0.92, 0.62, 0.92, 2, 0.18)
const flameMidGeo = new RoundedBoxGeometry(0.6, 0.5, 0.6, 2, 0.14)
const flameCoreGeo = new RoundedBoxGeometry(0.32, 0.4, 0.32, 2, 0.1)

export function makeFlameCell(hot = false): THREE.Group {
  const g = new THREE.Group()
  const outer = new THREE.Mesh(
    flameOuterGeo,
    new THREE.MeshBasicMaterial({ color: hot ? 0xd00000 : 0xff7b1c, transparent: true, opacity: 0.92 }),
  )
  outer.position.y = 0.36
  const mid = new THREE.Mesh(
    flameMidGeo,
    new THREE.MeshBasicMaterial({ color: hot ? 0xff5b00 : 0xffc93d }),
  )
  mid.position.y = 0.36
  const core = new THREE.Mesh(
    flameCoreGeo,
    new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
  )
  core.position.y = 0.36
  g.add(outer, mid, core)
  return g
}
