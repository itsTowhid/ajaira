import * as THREE from 'three'
import { mulberry32, rand, chance } from '../rng'
import type { BoxCollider, CircleCollider } from '../city/layout'
import {
  ROAD_HALF,
  distanceToRoadCentre,
  heightAt,
  roadOffset,
  roadProximityAt,
} from './terrain'

export const TILE = 96
export const ROAD_W = 12

export interface Ramp {
  x: number
  z: number
  axis: 'x' | 'z'
  dir: 1 | -1
}

export interface Tile {
  group: THREE.Group
  boxes: BoxCollider[]
  circles: CircleCollider[]
  ramps: Ramp[]
  spinners: THREE.Object3D[]
  grassCount: number
}

function hashTile(tx: number, tz: number): number {
  return ((tx * 374761393 + tz * 668265263) ^ (tx << 7)) >>> 0
}

// Shared materials for props; the terrain mesh owns a single vertex-color
// material. Per-tile geometries (terrain plane, barn, windmill, ramps) are
// created fresh per tile and disposed on prune. Grass geometry/material below
// are module-level shared and must NEVER be disposed per tile.
const mat = {
  terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
  barn: new THREE.MeshLambertMaterial({ color: 0xb5533c }),
  roof: new THREE.MeshLambertMaterial({ color: 0x8a3d2e }),
  tower: new THREE.MeshLambertMaterial({ color: 0xcbb79a }),
  blade: new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }),
  ramp: new THREE.MeshLambertMaterial({ color: 0xb98a5a }),
}

// Grass detail (visual only, no colliders): one shared cone + one shared
// material for all tiles. Per-tile InstancedMesh instances are disposed on
// prune via InstancedMesh.dispose() (instance buffers only); this geometry
// and material live for the whole session.
const GRASS_BASE_HEIGHT = 1
export const GRASS_GEO = new THREE.ConeGeometry(0.16, GRASS_BASE_HEIGHT, 5)
GRASS_GEO.translate(0, GRASS_BASE_HEIGHT / 2, 0)
export const GRASS_MAT = new THREE.MeshLambertMaterial({ color: 0xffffff })
const GRASS_COLORS = [0x6aae5c, 0x8fbf6a, 0x7fc46b].map((h) => new THREE.Color(h))
const GRASS_HEIGHTS = [0.5, 0.7, 0.9]

const mod3 = (n: number) => ((n % 3) + 3) % 3

const C_GRASS = [new THREE.Color(0x7fc46b), new THREE.Color(0x8fbf6a), new THREE.Color(0x6aae5c)]
const C_WHEAT = new THREE.Color(0xd9c37e)
const C_ROAD = new THREE.Color(0x9b7d54)
const C_PLOW = new THREE.Color(0x8a6b4f)
const C_WATER = new THREE.Color(0x6fa8c9)

/** Cheap deterministic per-vertex variation so the grass is not a flat tint. */
function grassVariant(x: number, z: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  const f = n - Math.floor(n)
  return f < 0.34 ? 0 : f < 0.67 ? 1 : 2
}

function makeRampGeometry(): THREE.ExtrudeGeometry {
  const LEN = 11
  const H = 2.4
  const W = 7
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(LEN, 0)
  shape.lineTo(LEN, H)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false })
  geo.translate(-LEN / 2, 0, -W / 2)
  return geo
}

interface Patch {
  x: number
  z: number
  w: number
  d: number
}

const insidePatch = (p: Patch, x: number, z: number): boolean =>
  Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2

export function generateTile(tx: number, tz: number): Tile {
  const rng = mulberry32(hashTile(tx, tz))
  const group = new THREE.Group()
  // Obstacle-free world: nothing may stop the vehicle, so these stay empty.
  // Kept (not removed) because consumers iterate them.
  const boxes: BoxCollider[] = []
  const circles: CircleCollider[] = []
  const ramps: Ramp[] = []
  const spinners: THREE.Object3D[] = []

  const baseX = tx * TILE
  const baseZ = tz * TILE
  const HALF = TILE / 2

  const vertical = mod3(tx) === 0
  const horizontal = mod3(tz) === 0

  // Curvy-road test in tile-local coords: the strip on this tile's line
  // wanders with world position, so neighbours drawing the same world point
  // compute the same centre.
  const onRoad = (lx: number, lz: number, pad: number): boolean => {
    if (vertical && Math.abs(lx - roadOffset('x', baseX, baseZ + lz)) < ROAD_W / 2 + pad)
      return true
    if (horizontal && Math.abs(lz - roadOffset('z', baseZ, baseX + lx)) < ROAD_W / 2 + pad)
      return true
    return false
  }

  // Wheat field rects: 1-2 per tile (paint only — fences removed).
  // Placed conservatively clear of the wandering strip (±14) so they never
  // straddle a road.
  const fields: Patch[] = []
  const fieldCount = 1 + Math.floor(rng() * 2)
  for (let i = 0; i < fieldCount; i++) {
    const w = rand(rng, 20, 40)
    const d = rand(rng, 20, 40)
    let fx = baseX
    let fz = baseZ
    let placed = false
    for (let attempt = 0; attempt < 8; attempt++) {
      const lx = rand(rng, -HALF + w / 2 + 2, HALF - w / 2 - 2)
      const lz = rand(rng, -HALF + d / 2 + 2, HALF - d / 2 - 2)
      if (vertical && Math.abs(lx) < ROAD_W / 2 + 14 + w / 2 + 1) continue
      if (horizontal && Math.abs(lz) < ROAD_W / 2 + 14 + d / 2 + 1) continue
      fx = baseX + lx
      fz = baseZ + lz
      placed = true
      break
    }
    if (!placed) {
      const lx = rand(rng, -HALF + w / 2 + 2, HALF - w / 2 - 2)
      const lz = rand(rng, -HALF + d / 2 + 2, HALF - d / 2 - 2)
      fx = baseX + lx
      fz = baseZ + lz
    }
    fields.push({ x: fx, z: fz, w, d })
  }

  // Plowed patch in ~15% of tiles (paint only).
  let plowed: Patch | null = null
  if (chance(rng, 0.15)) {
    const w = rand(rng, 16, 30)
    const d = rand(rng, 16, 30)
    const lx = rand(rng, -HALF + w / 2 + 2, HALF - w / 2 - 2)
    const lz = rand(rng, -HALF + d / 2 + 2, HALF - d / 2 - 2)
    plowed = { x: baseX + lx, z: baseZ + lz, w, d }
  }

  // Pond: 6%, no collider. Centre + radius feed the terrain mesh (level water)
  // before any prop is placed.
  interface Pond {
    x: number
    z: number
    r: number
    y: number
  }
  let pond: Pond | null = null
  if (chance(rng, 0.06)) {
    const r = rand(rng, 6, 10)
    const lx = rand(rng, -HALF + r + 2, HALF - r - 2)
    const lz = rand(rng, -HALF + r + 2, HALF - r - 2)
    const px = baseX + lx
    const pz = baseZ + lz
    pond = { x: px, z: pz, r, y: heightAt(px, pz) }
  }

  // One terrain mesh per tile: displaced grid, vertex colors, no seams (every
  // sample is a pure function of world coords).
  {
    const SEG = 16
    const geo = new THREE.PlaneGeometry(TILE, TILE, SEG, SEG)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const wx = baseX + pos.getX(i)
      const wz = baseZ + pos.getZ(i)
      const prox = roadProximityAt(wx, wz)
      let y = heightAt(wx, wz, prox)
      tmp.copy(C_GRASS[grassVariant(wx, wz)])
      for (const f of fields) {
        if (insidePatch(f, wx, wz)) {
          tmp.copy(C_WHEAT)
          break
        }
      }
      if (plowed && insidePatch(plowed, wx, wz)) tmp.copy(C_PLOW)
      if (distanceToRoadCentre(wx, wz) <= ROAD_HALF) tmp.copy(C_ROAD)
      if (pond) {
        const dx = wx - pond.x
        const dz = wz - pond.z
        if (dx * dx + dz * dz <= pond.r * pond.r) {
          y = pond.y
          tmp.copy(C_WATER)
        }
      }
      pos.setY(i, y)
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const mesh = new THREE.Mesh(geo, mat.terrain)
    mesh.position.set(baseX, 0, baseZ)
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // Barn: 8%, VISUAL ONLY — no collider (car passes through).
  if (chance(rng, 0.08)) {
    let bx = baseX
    let bz = baseZ
    for (let attempt = 0; attempt < 8; attempt++) {
      const lx = rand(rng, -28, 28)
      const lz = rand(rng, -28, 28)
      if (onRoad(lx, lz, 7)) continue
      bx = baseX + lx
      bz = baseZ + lz
      break
    }
    if (onRoad(bx - baseX, bz - baseZ, 7)) {
      bx = baseX + 24
      bz = baseZ + 24
    }
    const h = heightAt(bx, bz)
    const bodyGeo = new THREE.BoxGeometry(10, 7, 8)
    const body = new THREE.Mesh(bodyGeo, mat.barn)
    body.position.set(bx, h + 3.5, bz)
    body.castShadow = true
    group.add(body)
    const roofGeo = new THREE.ConeGeometry(6.4, 3, 4)
    const roof = new THREE.Mesh(roofGeo, mat.roof)
    roof.position.set(bx, h + 7 + 1.5, bz)
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    group.add(roof)
  }

  // Windmill: 4%, VISUAL ONLY — no collider. Blades keep spinning.
  if (chance(rng, 0.04)) {
    let wx = baseX
    let wz = baseZ
    for (let attempt = 0; attempt < 8; attempt++) {
      const lx = rand(rng, -30, 30)
      const lz = rand(rng, -30, 30)
      if (onRoad(lx, lz, 5)) continue
      wx = baseX + lx
      wz = baseZ + lz
      break
    }
    const h = heightAt(wx, wz)
    const towerGeo = new THREE.CylinderGeometry(1.2, 1.8, 12, 8)
    const tower = new THREE.Mesh(towerGeo, mat.tower)
    tower.position.set(wx, h + 6, wz)
    tower.castShadow = true
    group.add(tower)
    const blades = new THREE.Group()
    blades.position.set(wx, h + 12, wz + 1.2)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2
      const bladeGeo = new THREE.BoxGeometry(0.4, 5, 0.1)
      const blade = new THREE.Mesh(bladeGeo, mat.blade)
      blade.position.set(-Math.sin(angle) * 2.5, Math.cos(angle) * 2.5, 0)
      blade.rotation.z = angle
      blade.castShadow = true
      blades.add(blade)
    }
    group.add(blades)
    spinners.push(blades)
  }

  // Ramps on road tiles, centred on the (curved) road centreline so they sit
  // on the road, with their base at the terrain height there. Physics in
  // main.ts reads the same heightAt, so launches stay aligned.
  if ((vertical || horizontal) && mod3(tx * 7 + tz * 13) === 0) {
    const addRamp = (axis: 'x' | 'z', dir: 1 | -1, lx: number, lz: number) => {
      const geo = makeRampGeometry()
      const mesh = new THREE.Mesh(geo, mat.ramp)
      if (axis === 'x') mesh.rotation.y = dir > 0 ? 0 : Math.PI
      else mesh.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2
      const x = baseX + lx
      const z = baseZ + lz
      mesh.position.set(x, heightAt(x, z), z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      ramps.push({ x, z, axis, dir })
    }
    if (vertical) {
      addRamp('z', 1, roadOffset('x', baseX, baseZ - 20), -20)
      addRamp('z', -1, roadOffset('x', baseX, baseZ + 20), 20)
    }
    if (horizontal) {
      addRamp('x', 1, -20, roadOffset('z', baseZ, baseX - 20))
      addRamp('x', -1, 20, roadOffset('z', baseZ, baseX + 20))
    }
  }

  // Grass detail (visual only, no colliders): one InstancedMesh per tile,
  // 40-70 blades scattered at rng positions; skipped on dirt roads and inside
  // ponds. Appended after all other features so earlier rng order is stable.
  let grassCount = 0
  {
    const target = 40 + Math.floor(rng() * 31)
    const mesh = new THREE.InstancedMesh(GRASS_GEO, GRASS_MAT, target)
    const dummy = new THREE.Object3D()
    let placed = 0
    for (let attempt = 0; attempt < target * 6 && placed < target; attempt++) {
      const lx = rand(rng, -HALF + 2, HALF - 2)
      const lz = rand(rng, -HALF + 2, HALF - 2)
      const wx = baseX + lx
      const wz = baseZ + lz
      if (distanceToRoadCentre(wx, wz) <= ROAD_HALF + 0.5) continue
      if (pond) {
        const dx = wx - pond.x
        const dz = wz - pond.z
        if (dx * dx + dz * dz <= pond.r * pond.r) continue
      }
      const sy = GRASS_HEIGHTS[Math.floor(rng() * GRASS_HEIGHTS.length)]
      dummy.position.set(wx, heightAt(wx, wz) - 0.05, wz)
      dummy.scale.set(1, sy, 1)
      dummy.rotation.y = rng() * Math.PI * 2
      dummy.updateMatrix()
      mesh.setMatrixAt(placed, dummy.matrix)
      mesh.setColorAt(placed, GRASS_COLORS[placed % GRASS_COLORS.length])
      placed++
    }
    mesh.count = placed
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    grassCount = placed
    group.add(mesh)
  }

  return { group, boxes, circles, ramps, spinners, grassCount }
}
