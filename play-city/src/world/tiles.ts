import * as THREE from 'three'
import { mulberry32, rand, pick, chance } from '../rng'
import type { BoxCollider, CircleCollider } from '../city/layout'

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

// Shared materials for repeated colours; geometries are per-mesh and disposed on prune.
const mat = {
  road: new THREE.MeshLambertMaterial({ color: 0x9b7d54 }),
  fields: [
    new THREE.MeshLambertMaterial({ color: 0xd9c37e }),
    new THREE.MeshLambertMaterial({ color: 0x8fbf6a }),
    new THREE.MeshLambertMaterial({ color: 0xa4c964 }),
    new THREE.MeshLambertMaterial({ color: 0x8a6b4f }),
  ],
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
  pond: new THREE.MeshLambertMaterial({ color: 0x6fa8c9 }),
  ramp: new THREE.MeshLambertMaterial({ color: 0xb98a5a }),
}

const mod3 = (n: number) => ((n % 3) + 3) % 3

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

  if (vertical) {
    const geo = new THREE.PlaneGeometry(ROAD_W, TILE)
    const mesh = new THREE.Mesh(geo, mat.road)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(baseX, 0.02, baseZ)
    mesh.receiveShadow = true
    group.add(mesh)
  }
  if (horizontal) {
    const geo = new THREE.PlaneGeometry(TILE, ROAD_W)
    const mesh = new THREE.Mesh(geo, mat.road)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(baseX, vertical ? 0.022 : 0.02, baseZ)
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const onRoad = (lx: number, lz: number, pad: number): boolean => {
    if (vertical && Math.abs(lx) < ROAD_W / 2 + pad) return true
    if (horizontal && Math.abs(lz) < ROAD_W / 2 + pad) return true
    return false
  }

  // Fields: 1-2 large rects.
  interface Field {
    x: number
    z: number
    w: number
    d: number
  }
  const fields: Field[] = []
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
      // Reject placements overlapping a road strip.
      if (vertical && Math.abs(lx) < ROAD_W / 2 + w / 2 + 1) continue
      if (horizontal && Math.abs(lz) < ROAD_W / 2 + d / 2 + 1) continue
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
    const color = pick(rng, mat.fields)
    const geo = new THREE.PlaneGeometry(w, d)
    const mesh = new THREE.Mesh(geo, color)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(fx, 0.015, fz)
    mesh.receiveShadow = true
    group.add(mesh)
    fields.push({ x: fx, z: fz, w, d })
  }

  // Fences along 1-2 field edges.
  for (const f of fields) {
    const runs = 1 + Math.floor(rng() * 2)
    const edges = [0, 1, 2, 3]
    // Shuffle edge order deterministically.
    for (let i = edges.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[edges[i], edges[j]] = [edges[j], edges[i]]
    }
    for (let i = 0; i < runs; i++) {
      const edge = edges[i % edges.length]
      const alongX = edge === 0 || edge === 1 // north/south run along x
      if (alongX) {
        const geo = new THREE.BoxGeometry(f.w, 0.9, 0.18)
        const mesh = new THREE.Mesh(geo, mat.fence)
        const z = f.z + (edge === 0 ? -f.d / 2 : f.d / 2)
        mesh.position.set(f.x, 0.45, z)
        mesh.castShadow = true
        group.add(mesh)
        boxes.push({ x: f.x, z, hw: f.w / 2, hd: 0.09 })
      } else {
        const geo = new THREE.BoxGeometry(0.18, 0.9, f.d)
        const mesh = new THREE.Mesh(geo, mat.fence)
        const x = f.x + (edge === 2 ? -f.w / 2 : f.w / 2)
        mesh.position.set(x, 0.45, f.z)
        mesh.castShadow = true
        group.add(mesh)
        boxes.push({ x, z: f.z, hw: 0.09, hd: f.d / 2 })
      }
    }
  }

  // Trees: 3-8, avoiding road strips.
  const treeCount = 3 + Math.floor(rng() * 6)
  for (let i = 0; i < treeCount; i++) {
    const lx = rand(rng, -HALF + 4, HALF - 4)
    const lz = rand(rng, -HALF + 4, HALF - 4)
    if (onRoad(lx, lz, 3)) continue
    const x = baseX + lx
    const z = baseZ + lz
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.35, 2.2, 7)
    const trunk = new THREE.Mesh(trunkGeo, mat.trunk)
    trunk.position.set(x, 1.1, z)
    trunk.castShadow = true
    group.add(trunk)
    const crownR = rand(rng, 1.6, 2.4)
    const crownGeo = new THREE.IcosahedronGeometry(crownR, 0)
    const crown = new THREE.Mesh(crownGeo, pick(rng, mat.crowns))
    crown.position.set(x, 2.2 + crownR * 0.7, z)
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
    const geo = new THREE.CylinderGeometry(1.1, 1.1, 1.6, 12)
    const mesh = new THREE.Mesh(geo, mat.hay)
    mesh.rotation.z = Math.PI / 2
    mesh.rotation.y = rng() * Math.PI * 2
    mesh.position.set(x, 1.1, z)
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
    const bodyGeo = new THREE.BoxGeometry(10, 7, 8)
    const body = new THREE.Mesh(bodyGeo, mat.barn)
    body.position.set(bx, 3.5, bz)
    body.castShadow = true
    group.add(body)
    const roofGeo = new THREE.ConeGeometry(6.4, 3, 4)
    const roof = new THREE.Mesh(roofGeo, mat.roof)
    roof.position.set(bx, 7 + 1.5, bz)
    roof.rotation.y = Math.PI / 4
    roof.castShadow = true
    group.add(roof)
    boxes.push({ x: bx, z: bz, hw: 5, hd: 4 })
  }

  // Windmill: 4%.
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
    const towerGeo = new THREE.CylinderGeometry(1.2, 1.8, 12, 8)
    const tower = new THREE.Mesh(towerGeo, mat.tower)
    tower.position.set(wx, 6, wz)
    tower.castShadow = true
    group.add(tower)
    const blades = new THREE.Group()
    blades.position.set(wx, 12, wz + 1.2)
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

  // Pond: 6%, no collider.
  if (chance(rng, 0.06)) {
    const r = rand(rng, 6, 10)
    const lx = rand(rng, -HALF + r + 2, HALF - r - 2)
    const lz = rand(rng, -HALF + r + 2, HALF - r - 2)
    const geo = new THREE.CircleGeometry(r, 24)
    const mesh = new THREE.Mesh(geo, mat.pond)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(baseX + lx, 0.012, baseZ + lz)
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // Ramps on road tiles.
  if ((vertical || horizontal) && mod3(tx * 7 + tz * 13) === 0) {
    const addRamp = (axis: 'x' | 'z', dir: 1 | -1, lx: number, lz: number) => {
      const geo = makeRampGeometry()
      const mesh = new THREE.Mesh(geo, mat.ramp)
      if (axis === 'x') mesh.rotation.y = dir > 0 ? 0 : Math.PI
      else mesh.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2
      const x = baseX + lx
      const z = baseZ + lz
      mesh.position.set(x, 0, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      ramps.push({ x, z, axis, dir })
    }
    if (vertical) {
      addRamp('z', 1, 0, -20)
      addRamp('z', -1, 0, 20)
    }
    if (horizontal) {
      addRamp('x', 1, -20, 0)
      addRamp('x', -1, 20, 0)
    }
  }

  return { group, boxes, circles, ramps, spinners }
}
