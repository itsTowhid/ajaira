import * as THREE from 'three'
import {
  BLOCK,
  CITY_HALF,
  CITY_SIZE,
  CURB_H,
  GRID,
  ROAD_W,
  type CityLayout,
  type PlaygroundProp,
} from './layout'
import { mat, PALETTE } from './materials'

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const unitCylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 12)
const unitCone = new THREE.ConeGeometry(0.5, 1, 10)

interface Placement {
  x: number
  y: number
  z: number
  rotY?: number
  sx?: number
  sy?: number
  sz?: number
  color?: number
}

function instance(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: Placement[],
  castShadow: boolean,
  receiveShadow = false,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const color = new THREE.Color()

  placements.forEach((p, index) => {
    position.set(p.x, p.y, p.z)
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY ?? 0)
    scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1)
    matrix.compose(position, quaternion, scale)
    mesh.setMatrixAt(index, matrix)
    if (p.color !== undefined) mesh.setColorAt(index, color.setHex(p.color))
  })

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.castShadow = castShadow
  mesh.receiveShadow = receiveShadow
  return mesh
}

function box(
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  rotY = 0,
  castShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(unitBox, material)
  mesh.position.set(x, y, z)
  mesh.scale.set(w, h, d)
  mesh.rotation.y = rotY
  mesh.castShadow = castShadow
  mesh.receiveShadow = true
  return mesh
}

function makeWindowBox(w: number, h: number, d: number, material: THREE.Material, cell = 1.75) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const scales = [
    [d / cell, h / cell],
    [d / cell, h / cell],
    [w / cell, d / cell],
    [w / cell, d / cell],
    [w / cell, h / cell],
    [w / cell, h / cell],
  ]
  for (let face = 0; face < 6; face++) {
    const [su, sv] = scales[face]
    for (let i = 0; i < 4; i++) {
      const index = face * 4 + i
      uv.setXY(index, uv.getX(index) * su, uv.getY(index) * sv)
    }
  }
  uv.needsUpdate = true
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function groundPlane(size: number, material: THREE.Material, y: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.receiveShadow = true
  return mesh
}

export function buildCity(layout: CityLayout): THREE.Group {
  const city = new THREE.Group()

  city.add(groundPlane(2400, mat.ground(), -0.04))
  city.add(groundPlane(CITY_SIZE + 260, mat.grass(), -0.02))
  city.add(groundPlane(CITY_SIZE, mat.asphalt(), 0))

  for (const lot of layout.lots) buildBlock(lot, city)

  addParkedCars(layout, city)
  addRoadMarkings(city)
  addPerimeterTrees(city)

  return city
}

function blockSurfaceMaterial(kind: string) {
  switch (kind) {
    case 'parking':
      return mat.asphaltLight()
    case 'park':
      return mat.grass()
    case 'playground':
      return mat.sidewalk()
    case 'plaza':
      return mat.sidewalk()
    default:
      return mat.sidewalk()
  }
}

function buildBlock(lot: CityLayout['lots'][number], parent: THREE.Group) {
  const { centerX: x, centerZ: z, kind } = lot
  parent.add(box(mat.curb(), x, CURB_H / 2, z, BLOCK, CURB_H, BLOCK, 0, false))

  const inner = BLOCK - 4.4
  parent.add(box(blockSurfaceMaterial(kind), x, CURB_H + 0.02, z, inner, 0.06, inner, 0, false))

  if (kind === 'buildings') {
    for (const b of lot.buildings) buildBuilding(b, parent)
    addBushes(lot, parent)
  } else if (kind === 'parking') {
    addParkingLot(lot, parent)
  } else if (kind === 'playground') {
    addPlayground(lot, parent)
  } else if (kind === 'park') {
    addPark(lot, parent)
  } else {
    addPlaza(lot, parent)
  }
}

function buildBuilding(b: CityLayout['lots'][number]['buildings'][number], parent: THREE.Group) {
  const baseH = b.setback ? b.h * 0.62 : b.h
  const windows = mat.buildingWindows(b.windowIndex, b.colorIndex)
  const body = makeWindowBox(b.w, baseH, b.d, windows)
  body.position.set(b.x, baseH / 2, b.z)
  parent.add(body)

  const roofColor = mat.roof(b.colorIndex)
  if (b.setback) {
    const topH = b.h - baseH
    const top = makeWindowBox(b.w * 0.68, topH, b.d * 0.68, windows)
    top.position.set(b.x, baseH + topH / 2, b.z)
    parent.add(top)
    parent.add(box(roofColor, b.x, b.h + 0.18, b.z, b.w * 0.72, 0.36, b.d * 0.72))
  } else {
    parent.add(box(roofColor, b.x, b.h + 0.18, b.z, b.w + 0.7, 0.36, b.d + 0.7))
  }

  parent.add(
    box(
      mat.roof(b.colorIndex + 1),
      b.x,
      b.h + 0.4,
      b.z,
      b.setback ? b.w * 0.72 - 1.4 : b.w - 1.4,
      0.06,
      b.setback ? b.d * 0.72 - 1.4 : b.d - 1.4,
      0,
      false,
    ),
  )

  if (b.roofBox) {
    const bw = Math.min(3.2, b.w * 0.4)
    parent.add(box(mat.metal(), b.x + b.w * 0.2, b.h + 0.9, b.z - b.d * 0.15, bw, 1.1, bw * 0.8))
  }

  if (b.antenna) {
    const mast = new THREE.Mesh(unitCylinder, mat.metal())
    mast.position.set(b.x - b.w * 0.25, b.h + 2.6, b.z + b.d * 0.2)
    mast.scale.set(0.22, 5, 0.22)
    parent.add(mast)
    const light = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: 0xff6b6b }))
    light.position.set(b.x - b.w * 0.25, b.h + 5.2, b.z + b.d * 0.2)
    light.scale.set(0.5, 0.5, 0.5)
    parent.add(light)
  }
}

function addBushes(lot: CityLayout['lots'][number], parent: THREE.Group) {
  const placements: Placement[] = []
  const count = 3 + Math.floor(lot.buildings.length)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + lot.index
    placements.push({
      x: lot.centerX + Math.cos(angle) * (BLOCK / 2 - 3.4),
      y: 0.55,
      z: lot.centerZ + Math.sin(angle) * (BLOCK / 2 - 3.4),
      sy: 0.9,
      sx: 0.9,
      sz: 0.9,
      color: 0x4faa52,
    })
  }
  const mesh = instance(unitCone, mat.foliage(1), placements, true)
  parent.add(mesh)
}

function addParkingLot(lot: CityLayout['lots'][number], parent: THREE.Group) {
  const stallW = 2.8
  const stallD = 5.4
  const innerW = BLOCK - 8
  const perRow = Math.floor(innerW / stallW)
  const usedW = perRow * stallW
  const rows = 3

  const lines: Placement[] = []
  for (let row = 0; row < rows; row++) {
    const rowZ = lot.centerZ - ((rows - 1) * (stallD * 1.6)) / 2 + row * stallD * 1.6
    for (let i = 0; i <= perRow; i++) {
      const x = lot.centerX - usedW / 2 + i * stallW
      lines.push({ x, y: CURB_H + 0.06, z: rowZ - stallD / 2 - 0.2, sx: 0.18, sy: 0.04, sz: stallD })
    }
    lines.push({ x: lot.centerX, y: CURB_H + 0.06, z: rowZ + stallD * 0.8 + 0.2, sx: usedW, sy: 0.04, sz: 0.18 })
  }
  parent.add(instance(unitBox, mat.paint(), lines, false))
}

function addParkedCars(layout: CityLayout, parent: THREE.Group) {
  const paint = new THREE.MeshLambertMaterial({ color: 0xffffff })
  const bodies: Placement[] = []
  const cabins: Placement[] = []
  const glass: Placement[] = []
  const bumpers: Placement[] = []
  const wheels: Placement[] = []

  for (const lot of layout.lots) {
    for (const car of lot.parkedCars) {
      const base = { x: car.x, y: CURB_H, z: car.z, rotY: car.rotation }
      bodies.push({ ...base, y: CURB_H + 0.86, sx: 2.0, sy: 0.62, sz: 4.3, color: PALETTE.cars[car.colorIndex % PALETTE.cars.length] })
      cabins.push({ ...base, y: CURB_H + 1.56, sx: 1.82, sy: 0.8, sz: 2.35, color: PALETTE.cars[car.colorIndex % PALETTE.cars.length] })
      glass.push({ ...base, y: CURB_H + 1.66, sx: 1.88, sy: 0.34, sz: 1.9 })
      for (const end of [1, -1]) {
        bumpers.push({ ...base, y: CURB_H + 0.72, z: car.z + end * 2.1, sx: 2.06, sy: 0.26, sz: 0.3 })
      }
      for (const [wx, wz] of [
        [-0.98, 1.3],
        [0.98, 1.3],
        [-0.98, -1.3],
        [0.98, -1.3],
      ]) {
        const cos = Math.cos(car.rotation)
        const sin = Math.sin(car.rotation)
        wheels.push({
          x: car.x + sin * wz + cos * wx,
          y: CURB_H + 0.56,
          z: car.z + cos * wz - sin * wx,
          sx: 0.36,
          sy: 1.12,
          sz: 1.12,
        })
      }
    }
  }

  parent.add(instance(unitBox, paint, bodies, true))
  parent.add(instance(unitBox, paint, cabins, true))
  parent.add(instance(unitBox, mat.glass(), glass, false))
  parent.add(instance(unitBox, mat.metal(), bumpers, false))
  const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12)
  wheelGeometry.rotateZ(Math.PI / 2)
  parent.add(instance(wheelGeometry, mat.tyre(), wheels, true))
}

const PLAYGROUND_FLOORS = [0xe8604f, 0x3fa9c9, 0xe8a33f, 0x8a6fd8]

function addPlayground(lot: CityLayout['lots'][number], parent: THREE.Group) {
  const floorColor = PLAYGROUND_FLOORS[lot.index % PLAYGROUND_FLOORS.length]
  const floor = new THREE.Mesh(unitBox, new THREE.MeshLambertMaterial({ color: floorColor }))
  floor.position.set(lot.centerX, CURB_H + 0.08, lot.centerZ)
  floor.scale.set(BLOCK - 8, 0.08, BLOCK - 8)
  floor.receiveShadow = true
  parent.add(floor)

  for (const prop of lot.props) buildPlaygroundProp(prop, parent)

  const posts: Placement[] = []
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2
    posts.push({
      x: lot.centerX + Math.cos(angle) * (BLOCK / 2 - 2),
      y: CURB_H + 0.5,
      z: lot.centerZ + Math.sin(angle) * (BLOCK / 2 - 2),
      sx: 0.22,
      sy: 1,
      sz: 0.22,
      color: [0xf2f4f0, 0xf2b134, 0x4fb3d9, 0x7ac74f, 0xb07ae0][i % 5],
    })
  }
  parent.add(instance(unitCylinder, mat.paint(), posts, true))
}

function buildPlaygroundProp(prop: PlaygroundProp, parent: THREE.Group) {
  const group = new THREE.Group()
  group.position.set(prop.x, CURB_H, prop.z)
  group.rotation.y = prop.rotation
  group.scale.setScalar(1.3)
  const color = mat.toy(prop.colorIndex)

  if (prop.kind === 'sandbox') {
    group.add(box(mat.paint(), 0, 0.12, 0, 4.4, 0.24, 4.4))
    group.add(box(mat.sidewalk(), 0, 0.3, 0, 3.6, 0.3, 3.6))
    const shovel = box(mat.toy((prop.colorIndex + 2) % 5), 0.8, 0.7, 0.4, 0.2, 1, 0.2)
    shovel.rotation.z = 0.4
    group.add(shovel)
  } else if (prop.kind === 'slide') {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      group.add(box(mat.metal(), sx * 0.9, 0.9, sz * 0.9, 0.18, 1.8, 0.18))
    }
    group.add(box(color, 0, 1.9, 0, 2.3, 0.24, 2.3))
    const ramp = box(color, 0, 1.0, 2.4, 1.3, 0.16, 4.4)
    ramp.rotation.x = -0.36
    group.add(ramp)
    group.add(box(mat.metal(), -0.85, 1.1, -1.7, 0.14, 2.2, 0.14, 0))
    group.add(box(mat.metal(), 0.85, 1.1, -1.7, 0.14, 2.2, 0.14))
    for (let i = 0; i < 3; i++) {
      group.add(box(mat.metal(), 0, 0.4 + i * 0.5, -2.1, 1.1, 0.12, 0.12))
    }
  } else if (prop.kind === 'swings') {
    for (const side of [-1, 1]) {
      const leg = box(mat.metal(), side * 2.6, 1.3, 0, 0.2, 2.6, 0.2)
      leg.rotation.z = side * 0.28
      group.add(leg)
    }
    group.add(box(color, 0, 2.5, 0, 6, 0.2, 0.2))
    for (const x of [-1.1, 1.1]) {
      group.add(box(mat.metal(), x, 1.85, 0, 0.06, 1.3, 0.06))
      group.add(box(color, x, 1.15, 0, 0.7, 0.12, 0.4))
    }
  } else if (prop.kind === 'rider') {
    group.add(box(mat.metal(), 0, 0.5, 0, 0.5, 1, 0.5))
    group.add(box(color, 0, 1.15, 0, 1.2, 0.6, 0.6))
    group.add(box(color, 0, 1.6, 0.5, 0.5, 0.9, 0.4))
  } else {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      group.add(box(mat.metal(), sx * 1.2, 1.4, sz * 1.2, 0.22, 2.8, 0.22))
    }
    group.add(box(color, 0, 3.0, 0, 3, 0.4, 3))
    const roof = new THREE.Mesh(unitCone, color)
    roof.position.set(0, 4.0, 0)
    roof.scale.set(3.6, 1.8, 3.6)
    roof.castShadow = true
    group.add(roof)
  }

  parent.add(group)
}

function addPark(lot: CityLayout['lots'][number], parent: THREE.Group) {
  if (lot.pond) {
    const pond = new THREE.Mesh(new THREE.CircleGeometry(5, 28), mat.water())
    pond.rotation.x = -Math.PI / 2
    pond.position.set(lot.centerX + 4, CURB_H + 0.1, lot.centerZ - 3)
    parent.add(pond)
  }
}

function addPlaza(lot: CityLayout['lots'][number], parent: THREE.Group) {
  const basin = new THREE.Mesh(unitCylinder, mat.sidewalk())
  basin.position.set(lot.centerX, CURB_H + 0.5, lot.centerZ)
  basin.scale.set(8.4, 1, 8.4)
  basin.castShadow = true
  basin.receiveShadow = true
  parent.add(basin)

  const water = new THREE.Mesh(new THREE.CircleGeometry(3.6, 24), mat.water())
  water.rotation.x = -Math.PI / 2
  water.position.set(lot.centerX, CURB_H + 1.02, lot.centerZ)
  parent.add(water)

  const spire = new THREE.Mesh(unitCylinder, mat.metal())
  spire.position.set(lot.centerX, CURB_H + 1.9, lot.centerZ)
  spire.scale.set(0.5, 2, 0.5)
  parent.add(spire)

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    const x = lot.centerX + Math.cos(angle) * 18.5
    const z = lot.centerZ + Math.sin(angle) * 18.5
    parent.add(box(mat.sidewalk(), x, CURB_H + 0.4, z, 3.2, 0.8, 3.2, angle))
    parent.add(box(mat.toy(i), x, CURB_H + 1.1, z, 2.6, 0.7, 2.6, angle))
  }

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.7
    const x = lot.centerX + Math.cos(angle) * 10
    const z = lot.centerZ + Math.sin(angle) * 10
    const stallColor = mat.toy((i + 2) % 5)
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      parent.add(box(mat.metal(), x + sx * 1.4, CURB_H + 1.1, z + sz * 1.4, 0.12, 2.2, 0.12))
    }
    const canopy = box(stallColor, x, CURB_H + 2.3, z, 3.4, 0.3, 3.4, angle)
    parent.add(canopy)
    parent.add(box(mat.trunk(), x, CURB_H + 0.5, z, 3, 1, 2, angle))
  }
}

function addRoadMarkings(city: THREE.Group) {
  const dashes: Placement[] = []
  const stripes: Placement[] = []

  for (let i = 0; i <= GRID; i++) {
    const road = -CITY_HALF + ROAD_W / 2 + i * (BLOCK + ROAD_W)
    for (let d = -CITY_HALF + 6; d < CITY_HALF; d += 9) {
      if (nearIntersection(d)) continue
      dashes.push({ x: road, y: 0.02, z: d, sx: 0.5, sy: 0.03, sz: 4 })
      dashes.push({ x: d, y: 0.02, z: road, sx: 4, sy: 0.03, sz: 0.5 })
    }
  }

  for (let gx = 0; gx <= GRID; gx++) {
    for (let gz = 0; gz <= GRID; gz++) {
      const x = -CITY_HALF + ROAD_W / 2 + gx * (BLOCK + ROAD_W)
      const z = -CITY_HALF + ROAD_W / 2 + gz * (BLOCK + ROAD_W)
      for (let s = 0; s < 6; s++) {
        const offset = -ROAD_W / 2 + 1.6 + s * 1.8
        stripes.push({ x: x + offset, y: 0.03, z: z - ROAD_W / 2 - 1.6, sx: 1, sy: 0.03, sz: 3 })
        stripes.push({ x: x + offset, y: 0.03, z: z + ROAD_W / 2 + 1.6, sx: 1, sy: 0.03, sz: 3 })
        stripes.push({ x: x - ROAD_W / 2 - 1.6, y: 0.03, z: z + offset, sx: 3, sy: 0.03, sz: 1 })
        stripes.push({ x: x + ROAD_W / 2 + 1.6, y: 0.03, z: z + offset, sx: 3, sy: 0.03, sz: 1 })
      }
    }
  }

  city.add(instance(unitBox, mat.paint(), dashes, false))
  city.add(instance(unitBox, mat.paint(), stripes, false))
}

function nearIntersection(position: number) {
  const spacing = BLOCK + ROAD_W
  const index = Math.round((position + CITY_HALF - ROAD_W / 2) / spacing)
  const center = -CITY_HALF + ROAD_W / 2 + index * spacing
  return Math.abs(position - center) < ROAD_W / 2 + 4
}

function addPerimeterTrees(city: THREE.Group) {
  const trunks: Placement[] = []
  const leaves: Placement[] = []
  const step = 7
  for (let p = -CITY_HALF - 24; p <= CITY_HALF + 24; p += step) {
    for (const [x, z] of [
      [p, -CITY_HALF - 18],
      [p, CITY_HALF + 18],
      [-CITY_HALF - 18, p],
      [CITY_HALF + 18, p],
    ] as [number, number][]) {
      const jitterX = ((p * 13) % 5) - 2
      const jitterZ = ((p * 7) % 5) - 2
      const scale = 0.9 + (((p * 31) % 7) / 7) * 0.6
      const px = x + jitterX
      const pz = z + jitterZ
      trunks.push({ x: px, y: 1.1 * scale, z: pz, sx: 0.4 * scale, sy: 2.2 * scale, sz: 0.4 * scale })
      leaves.push({
        x: px,
        y: 3.1 * scale,
        z: pz,
        sx: 3 * scale,
        sy: 3.5 * scale,
        sz: 3 * scale,
        rotY: p,
        color: [0x4faa52, 0x5fbf62, 0x3f9a48][Math.abs(Math.round(p)) % 3],
      })
    }
  }
  city.add(instance(unitCylinder, mat.trunk(), trunks, true))
  city.add(instance(new THREE.IcosahedronGeometry(0.5, 0), mat.foliage(1), leaves, true))
}
