import { chance, mulberry32, pick, rand, type Rng } from '../rng'

export const ROAD_W = 12
export const BLOCK = 46
export const CELL = BLOCK + ROAD_W
export const GRID = 6
export const CURB_H = 0.14

export const CITY_SIZE = GRID * BLOCK + (GRID + 1) * ROAD_W
export const CITY_HALF = CITY_SIZE / 2
export const LANE = 3.4

/** Centre line of every road, parallel to the X or Z axis. */
export const ROAD_LINES: number[] = Array.from(
  { length: GRID + 1 },
  (_, i) => -CITY_HALF + ROAD_W / 2 + i * CELL,
)

export const blockCenter = (index: number) => -CITY_HALF + ROAD_W + BLOCK / 2 + index * CELL

export type BlockKind = 'buildings' | 'parking' | 'playground' | 'park' | 'plaza'

export interface BuildingLot {
  x: number
  z: number
  w: number
  d: number
  h: number
  colorIndex: number
  windowIndex: number
  setback: boolean
  antenna: boolean
  roofBox: boolean
}

export interface ParkedCar {
  x: number
  z: number
  rotation: number
  colorIndex: number
}

export interface TreeSpot {
  x: number
  z: number
  scale: number
  rotation: number
  id: number
}

export interface BoxCollider {
  x: number
  z: number
  hw: number
  hd: number
  breakable?: number
  destroyed?: boolean
}

export interface CircleCollider {
  x: number
  z: number
  r: number
  breakable?: number
  destroyed?: boolean
  trafficIndex?: number
}

export type BreakableKind = 'lamp' | 'bench' | 'crate' | 'tree'

export interface BreakableSpec {
  id: number
  kind: BreakableKind
  x: number
  z: number
  rotation: number
  colorIndex: number
  scale: number
}

export interface PlaygroundProp {
  kind: 'slide' | 'swings' | 'sandbox' | 'rider' | 'tower'
  x: number
  z: number
  rotation: number
  colorIndex: number
}

export interface BlockLot {
  index: number
  kind: BlockKind
  centerX: number
  centerZ: number
  buildings: BuildingLot[]
  parkedCars: ParkedCar[]
  trees: TreeSpot[]
  props: PlaygroundProp[]
  pond: boolean
  fountain: boolean
}

export interface CityLayout {
  seed: number
  lots: BlockLot[]
  colliders: BoxCollider[]
  circles: CircleCollider[]
  lamps: { x: number; z: number; rotation: number; id: number }[]
  trees: { x: number; z: number; rotation: number; scale: number; id: number }[]
  breakables: BreakableSpec[]
}

const BLOCK_KIND_WEIGHTS: [BlockKind, number][] = [
  ['buildings', 0.44],
  ['parking', 0.18],
  ['playground', 0.12],
  ['park', 0.16],
  ['plaza', 0.1],
]

function chooseKind(rng: Rng): BlockKind {
  let roll = rng()
  for (const [kind, weight] of BLOCK_KIND_WEIGHTS) {
    roll -= weight
    if (roll <= 0) return kind
  }
  return 'buildings'
}

interface Rect {
  x: number
  z: number
  w: number
  d: number
}

function subdivide(rng: Rng, rect: Rect, depth: number, minSize: number, out: Rect[]) {
  const fitsMore = rect.w > minSize * 2 || rect.d > minSize * 2
  if (depth <= 0 || !fitsMore) {
    out.push(rect)
    return
  }
  const splitAlongX = rect.w > rect.d ? true : rect.d > rect.w ? false : chance(rng, 0.5)
  const t = rand(rng, 0.38, 0.62)
  if (splitAlongX) {
    const left = rect.w * t
    subdivide(rng, { x: rect.x - rect.w / 2 + left / 2, z: rect.z, w: left, d: rect.d }, depth - 1, minSize, out)
    subdivide(rng, { x: rect.x + rect.w / 2 - (rect.w - left) / 2, z: rect.z, w: rect.w - left, d: rect.d }, depth - 1, minSize, out)
  } else {
    const near = rect.d * t
    subdivide(rng, { x: rect.x, z: rect.z - rect.d / 2 + near / 2, w: rect.w, d: near }, depth - 1, minSize, out)
    subdivide(rng, { x: rect.x, z: rect.z + rect.d / 2 - (rect.d - near) / 2, w: rect.w, d: rect.d - near }, depth - 1, minSize, out)
  }
}

class CityBuilder {
  readonly layout: CityLayout

  constructor(readonly rng: Rng, seed: number) {
    this.layout = { seed, lots: [], colliders: [], circles: [], lamps: [], trees: [], breakables: [] }
  }

  breakable(
    kind: BreakableKind,
    x: number,
    z: number,
    rotation: number,
    colorIndex: number,
    scale = 1,
  ) {
    const id = this.layout.breakables.length
    this.layout.breakables.push({ id, kind, x, z, rotation, colorIndex, scale })
    return id
  }

  box(x: number, z: number, hw: number, hd: number, breakable?: number) {
    this.layout.colliders.push({ x, z, hw, hd, breakable })
  }

  circle(x: number, z: number, r: number, breakable?: number) {
    this.layout.circles.push({ x, z, r, breakable })
  }
}

function fillWithBuildings(builder: CityBuilder, block: BlockLot) {
  const { rng, layout } = builder
  const rects: Rect[] = []
  subdivide(rng, { x: block.centerX, z: block.centerZ, w: BLOCK - 6, d: BLOCK - 6 }, 3, 15, rects)

  for (const rect of rects) {
    if (chance(rng, 0.08)) continue
    const inset = rand(rng, 1.2, 3)
    const w = Math.max(6, rect.w - inset * 2)
    const d = Math.max(6, rect.d - inset * 2)
    const area = w * d
    const nearCentre = Math.hypot(rect.x, rect.z) < CITY_HALF * 0.5
    const h = rand(rng, 7, nearCentre ? 44 : 26) * (area < 200 ? 0.7 : 1)
    const setback = h > 24 && chance(rng, 0.6)
    block.buildings.push({
      x: rect.x,
      z: rect.z,
      w,
      d,
      h,
      colorIndex: Math.floor(rng() * 12),
      windowIndex: Math.floor(rand(rng, 0, 3)),
      setback,
      antenna: h > 30 && chance(rng, 0.5),
      roofBox: chance(rng, 0.7),
    })
  }

  for (const b of block.buildings) {
    layout.colliders.push({ x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2 })
  }
}

const STALL_W = 2.8
const STALL_D = 5.4

function parkingDimensions() {
  const perRow = Math.floor((BLOCK - 8) / STALL_W)
  const usedW = perRow * STALL_W
  const rows = 3
  return { perRow, usedW, rows }
}

function fillWithParking(builder: CityBuilder, block: BlockLot) {
  const { rng } = builder
  const carColors = [0, 1, 2, 3, 4, 5, 6, 7]
  const { perRow, usedW, rows } = parkingDimensions()

  for (let row = 0; row < rows; row++) {
    const rowZ = block.centerZ - ((rows - 1) * (STALL_D * 1.6)) / 2 + row * STALL_D * 1.6
    for (let i = 0; i < perRow; i++) {
      const x = block.centerX - usedW / 2 + STALL_W * (i + 0.5)
      for (const side of [-1, 1]) {
        if (!chance(rng, 0.42)) continue
        const z = rowZ + side * (STALL_D / 2 + 0.2)
        block.parkedCars.push({ x, z, rotation: side < 0 ? 0 : Math.PI, colorIndex: pick(rng, carColors) })
        builder.box(x, z, 1.05, 2.3)
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    const x = block.centerX - usedW / 2 + 4 + (i * (usedW - 8)) / 3
    builder.breakable('crate', x, block.centerZ + (i % 2 === 0 ? 1 : -1) * 1.4, rand(rng, 0, Math.PI), Math.floor(rng() * 4), 1)
    builder.box(x, block.centerZ, 0.8, 0.8)
  }
}

function fillWithPlayground(builder: CityBuilder, block: BlockLot) {
  const { rng } = builder
  const propColors = [0, 1, 2, 3, 4]
  const kinds: PlaygroundProp['kind'][] = ['slide', 'swings', 'sandbox', 'rider', 'tower']
  const count = 4 + Math.floor(rng() * 2)

  for (let i = 0; i < count; i++) {
    const x = block.centerX + rand(rng, -1, 1) * (BLOCK / 2 - 9)
    const z = block.centerZ + rand(rng, -1, 1) * (BLOCK / 2 - 9)
    const kind = kinds[i % kinds.length]
    block.props.push({
      kind,
      x,
      z,
      rotation: Math.round(rng() * 3) * (Math.PI / 2) + (chance(rng, 0.5) ? 0 : Math.PI / 4),
      colorIndex: pick(rng, propColors),
    })
    if (kind === 'sandbox') continue
    builder.box(x, z, kind === 'swings' ? 4.2 : 2.6, kind === 'swings' ? 1.2 : 2.2)
  }

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2
    builder.circle(block.centerX + Math.cos(angle) * (BLOCK / 2 - 2), block.centerZ + Math.sin(angle) * (BLOCK / 2 - 2), 0.45)
  }
}

function addBench(builder: CityBuilder, x: number, z: number, rotation: number) {
  const id = builder.breakable('bench', x, z, rotation, 0, 1)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  builder.box(x + cos * 0.2, z - sin * 0.2, 1.3, 0.4, id)
}

function fillWithPark(builder: CityBuilder, block: BlockLot) {
  const { rng } = builder
  const treeCount = 8 + Math.floor(rng() * 7)
  for (let i = 0; i < treeCount; i++) {
    const x = block.centerX + rand(rng, -1, 1) * (BLOCK / 2 - 4)
    const z = block.centerZ + rand(rng, -1, 1) * (BLOCK / 2 - 4)
    const scale = rand(rng, 0.85, 1.5)
    const rotation = rng() * Math.PI * 2
    const id = builder.breakable('tree', x, z, rotation, Math.floor(rng() * 3), scale)
    block.trees.push({ x, z, scale, rotation, id })
    builder.circle(x, z, 0.7 * scale, id)
  }

  block.pond = chance(rng, 0.5)
  if (block.pond) {
    builder.circle(block.centerX + rand(rng, -6, 6), block.centerZ + rand(rng, -6, 6), 5)
  }

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.6
    addBench(builder, block.centerX + Math.cos(angle) * 9, block.centerZ + Math.sin(angle) * 9, angle)
  }
}

function fillWithPlaza(builder: CityBuilder, block: BlockLot) {
  const { rng } = builder
  builder.box(block.centerX, block.centerZ, 4.4, 4.4)

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    const x = block.centerX + Math.cos(angle) * 11
    const z = block.centerZ + Math.sin(angle) * 11
    const scale = rand(rng, 0.9, 1.2)
    const id = builder.breakable('tree', x, z, rng() * Math.PI, Math.floor(rng() * 3), scale)
    block.trees.push({ x, z, scale, rotation: 0, id })
    builder.circle(x, z, 0.8, id)
  }

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    addBench(builder, block.centerX + Math.cos(angle) * 15, block.centerZ + Math.sin(angle) * 15, angle + Math.PI / 2)
  }

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.7
    const x = block.centerX + Math.cos(angle) * 10
    const z = block.centerZ + Math.sin(angle) * 10
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      builder.box(x + sx * 1.4, z + sz * 1.4, 0.12, 0.12)
    }
    builder.box(x, z, 1.7, 1.7)
  }
}

function fillBlock(builder: CityBuilder, block: BlockLot) {
  switch (block.kind) {
    case 'buildings':
      fillWithBuildings(builder, block)
      break
    case 'parking':
      fillWithParking(builder, block)
      break
    case 'playground':
      fillWithPlayground(builder, block)
      break
    case 'park':
      fillWithPark(builder, block)
      break
    default:
      fillWithPlaza(builder, block)
  }
}

function addStreetFurniture(builder: CityBuilder) {
  const { rng, layout } = builder
  for (let i = 0; i <= GRID; i++) {
    const road = ROAD_LINES[i]
    // Lamps sit opposite the middle of a block face, never in a carriageway.
    for (let face = 0; face < GRID; face++) {
      const along = blockCenter(face)
      for (const side of [-1, 1]) {
        if (!chance(rng, 0.55)) continue
        const x = road + side * (ROAD_W / 2 + 1.4)
        layout.lamps.push({ x, z: along, rotation: side < 0 ? 0 : Math.PI, id: builder.breakable('lamp', x, along, side < 0 ? 0 : Math.PI, 0, 1) })
        builder.circle(x, along, 0.45, layout.lamps[layout.lamps.length - 1].id)

        const z = road + side * (ROAD_W / 2 + 1.4)
        const rotation = side < 0 ? Math.PI / 2 : -Math.PI / 2
        layout.lamps.push({ x: along, z, rotation, id: builder.breakable('lamp', along, z, rotation, 0, 1) })
        builder.circle(along, z, 0.45, layout.lamps[layout.lamps.length - 1].id)
      }
    }
  }
}

export function generateCityLayout(seed = 20240517): CityLayout {
  const builder = new CityBuilder(mulberry32(seed), seed)
  const { layout, rng } = builder
  const kinds: BlockKind[] = []

  for (let gz = 0; gz < GRID; gz++) {
    for (let gx = 0; gx < GRID; gx++) {
      const kind = chooseKind(rng)
      kinds.push(kind)
      const block: BlockLot = {
        index: layout.lots.length,
        kind,
        centerX: blockCenter(gx),
        centerZ: blockCenter(gz),
        buildings: [],
        parkedCars: [],
        trees: [],
        props: [],
        pond: false,
        fountain: false,
      }
      layout.lots.push(block)
      fillBlock(builder, block)
    }
  }

  for (const required of ['parking', 'playground', 'park', 'plaza'] as BlockKind[]) {
    if (kinds.includes(required)) continue
    const block = layout.lots[Math.floor(rng() * layout.lots.length)]
    if (block.kind !== 'buildings') continue
    const inside = (x: number, z: number) =>
      Math.abs(x - block.centerX) <= BLOCK / 2 && Math.abs(z - block.centerZ) <= BLOCK / 2
    layout.colliders = layout.colliders.filter((c) => !inside(c.x, c.z))
    layout.circles = layout.circles.filter((c) => !inside(c.x, c.z))
    layout.breakables = layout.breakables.filter((b) => !inside(b.x, b.z))
    layout.lamps = layout.lamps.filter((l) => !inside(l.x, l.z))
    layout.trees = layout.trees.filter((t) => !inside(t.x, t.z))
    block.kind = required
    block.buildings = []
    fillBlock(builder, block)
  }

  addStreetFurniture(builder)
  return layout
}
