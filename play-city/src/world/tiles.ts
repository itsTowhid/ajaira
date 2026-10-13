import * as THREE from 'three'
import { mulberry32, rand, pick, chance } from '../rng'
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
}

function hashTile(tx: number, tz: number): number {
  return ((tx * 374761393 + tz * 668265263) ^ (tx << 7)) >>> 0
}

// Shared materials for props; the terrain mesh owns a single vertex-color
// material. Geometries are per-mesh and disposed on prune.
const mat = {
  terrain: new THREE.MeshLambertMaterial({ vertexColors: true }),
  fence: new THREE.MeshLambertMaterial({ color: 0xb99a6b }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x8a6238 }),
  crowns: [
    new THREE.MeshLambertMaterial({ color: 0x4e8a3e }),
    new THREE.MeshLambertMaterial({ color: 0x5da24a }),
    new THREE.MeshLambertMaterial({ color: 0x3e7a34 }),
  ],
  hay: new THREE.MeshLambertMaterial({ color: 0xd8b95e }),
  barn: new THREE.MeshLambertMaterial({ color: 0xb5533c }),
  roof: new THREE.MeshLambertMaterial({ color: 0x8a3d2e }),
  tower: new THREE.MeshLambertMaterial({ color: 0xcbb79a }),
  blade: new THREE.MeshLambertMaterial({ color: 0xe8dcc0 }),
  ramp: new THREE.MeshLambertMaterial({ color: 0xb98a5a }),
}

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

  // Wheat field rects: 1-2 per tile, tracked for fences. Placed conservatively
  // clear of the wandering strip (±14) so they never straddle a road.
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

  // Plowed patch in ~15% of tiles, like wheat but unfenced.
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

  // Fences along 1-2 field edges, split into 2-3 segments that each follow
  // the terrain at their own end-averaged height, sunk 0.25.
  for (const f of fields) {
    const runs = 1 + Math.floor(rng() * 2)
    const edges = [0, 1, 2, 3]
    for (let i = edges.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[edges[i], edges[j]] = [edges[j], edges[i]]
    }
    for (let i = 0; i < runs; i++) {
      const edge = edges[i % edges.length]
      const alongX = edge === 0 || edge === 1 // north/south run along x
      const segs = 2 + Math.floor(rng() * 2)
      if (alongX) {
        const z = f.z + (edge === 0 ? -f.d / 2 : f.d / 2)
        const segLen = f.w / segs
        for (let k = 0; k < segs; k++) {
          const x0 = f.x - f.w / 2 + segLen * k
          const x1 = x0 + segLen
          const cx = (x0 + x1) / 2
          const y = (heightAt(x0, z) + heightAt(x1, z)) / 2 + 0.2
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.9, 0.18), mat.fence)
          mesh.position.set(cx, y, z)
          mesh.castShadow = true
          group.add(mesh)
          boxes.push({ x: cx, z, hw: segLen / 2, hd: 0.09 })
        }
      } else {
        const x = f.x + (edge === 2 ? -f.w / 2 : f.w / 2)
        const segLen = f.d / segs
        for (let k = 0; k < segs; k++) {
          const z0 = f.z - f.d / 2 + segLen * k
          const z1 = z0 + segLen
          const cz = (z0 + z1) / 2
          const y = (heightAt(x, z0) + heightAt(x, z1)) / 2 + 0.2
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, segLen), mat.fence)
          mesh.position.set(x, y, cz)
          mesh.castShadow = true
          group.add(mesh)
          boxes.push({ x, z: cz, hw: 0.09, hd: segLen / 2 })
        }
      }
    }
  }

  // Trees: 3-8, avoiding road strips, rooted on the terrain.
  const treeCount = 3 + Math.floor(rng() * 6)
  for (let i = 0; i < treeCount; i++) {
    const lx = rand(rng, -HALF + 4, HALF - 4)
    const lz = rand(rng, -HALF + 4, HALF - 4)
    if (onRoad(lx, lz, 3)) continue
    const x = baseX + lx
    const z = baseZ + lz
    const h = heightAt(x, z)
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.35, 2.2, 7)
    const trunk = new THREE.Mesh(trunkGeo, mat.trunk)
    trunk.position.set(x, h + 1.1, z)
    trunk.castShadow = true
    group.add(trunk)
    const crownR = rand(rng, 1.6, 2.4)
    const crownGeo = new THREE.IcosahedronGeometry(crownR, 0)
    const crown = new THREE.Mesh(crownGeo, pick(rng, mat.crowns))
    crown.position.set(x, h + 2.2 + crownR * 0.7, z)
    crown.castShadow = true
    group.add(crown)
    circles.push({ x, z, r: 0.9 })
  }

  // Hay bales: 0-3.
  const hayCount = Math.floor(rng() * 4)
  for (let i = 0; i < hayCount; i++) {
    const lx = rand(rng, -HALF + 4, HALF - 4)
    const lz = rand(rng, -HALF + 4, HALF - 4)
    if (onRoad(lx, lz, 2)) continue
    const x = baseX + lx
    const z = baseZ + lz
    const h = heightAt(x, z)
    const geo = new THREE.CylinderGeometry(1.1, 1.1, 1.6, 12)
    const mesh = new THREE.Mesh(geo, mat.hay)
    mesh.rotation.z = Math.PI / 2
    mesh.rotation.y = rng() * Math.PI * 2
    mesh.position.set(x, h + 1.1, z)
    mesh.castShadow = true
    group.add(mesh)
    circles.push({ x, z, r: 1.1 })
  }

  // Barn: 8%.
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
    boxes.push({ x: bx, z: bz, hw: 5, hd: 4 })
  }

  // Windmill: 4%. Tower rooted on the terrain; blades keep spinning.
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
    circles.push({ x: wx, z: wz, r: 2 })
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

  return { group, boxes, circles, ramps, spinners }
}
