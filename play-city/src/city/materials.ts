import * as THREE from 'three'

export const PALETTE = {
  sky: 0xbfdcf5,
  fog: 0xc8dff2,
  grass: 0x7fc46b,
  grassDark: 0x63ad53,
  asphalt: 0x50535c,
  asphaltLight: 0x6a6e78,
  curb: 0xd6d3cb,
  sidewalk: 0xc9c6bf,
  paint: 0xf2f4f0,
  trunk: 0x8a5a3b,
  foliage: [0x4faa52, 0x5fbf62, 0x3f9a48],
  metal: 0xb8bcc4,
  water: 0x4aa3d8,
  rubber: [0xe05a5a, 0xf2b134, 0x4fb3d9, 0x7ac74f, 0xb07ae0],
  buildings: [
    0xf6dcc4, 0xe0a978, 0xd08f7a, 0x9fc0dd, 0x6f9fc4, 0x4f86b8,
    0xf2c0c8, 0xc0a4e0, 0x9fd8b8, 0xf5cf6b, 0x8fae7a, 0xbdbdbd,
  ],
  roofs: [0x8f8b84, 0x6f6b66, 0xa39c92, 0x5f5b57],
  cars: [
    0xe8453c, 0xf5a623, 0x3d7dd6, 0x58b368, 0xf0f0f0,
    0x2f3b4a, 0xb05ec4, 0x20b8c4,
  ],
  glass: 0x9fd0e8,
  windowLight: 0xfff2c4,
  tyre: 0x33363d,
  rider: 0x33415a,
  helmet: 0xe8e4dc,
} as const

const cache = new Map<string, THREE.Material>()

function standard(key: string, material: THREE.Material): THREE.Material {
  cache.set(key, material)
  return material
}

export const mat = {
  ground: () =>
    standard('ground', new THREE.MeshLambertMaterial({ color: PALETTE.grass })),

  grass: () =>
    standard('grass', new THREE.MeshLambertMaterial({ color: PALETTE.grassDark })),

  asphalt: () =>
    standard('asphalt', new THREE.MeshLambertMaterial({ color: PALETTE.asphalt })),

  asphaltLight: () =>
    standard('asphaltLight', new THREE.MeshLambertMaterial({ color: PALETTE.asphaltLight })),

  curb: () =>
    standard('curb', new THREE.MeshLambertMaterial({ color: PALETTE.curb })),

  sidewalk: () =>
    standard('sidewalk', new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk })),

  paint: () =>
    standard('paint', new THREE.MeshLambertMaterial({ color: PALETTE.paint })),

  metal: () =>
    standard('metal', new THREE.MeshLambertMaterial({ color: PALETTE.metal })),

  tyre: () =>
    standard('tyre', new THREE.MeshLambertMaterial({ color: PALETTE.tyre })),

  trunk: () =>
    standard('trunk', new THREE.MeshLambertMaterial({ color: PALETTE.trunk })),

  water: () =>
    standard('water', new THREE.MeshLambertMaterial({ color: PALETTE.water })),

  glass: () =>
    standard('glass', new THREE.MeshLambertMaterial({ color: PALETTE.glass, transparent: true, opacity: 0.85 })),

  windows: (index: number) => {
    const key = `windows-${index}`
    const existing = cache.get(key)
    if (existing) return existing
    const texture = makeWindowTexture(index)
    const material = new THREE.MeshLambertMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(PALETTE.windowLight),
      emissiveIntensity: 0.32,
    })
    return standard(key, material)
  },

  buildingWindows: (windowIndex: number, colorIndex: number) => {
    const key = `buildingWindows-${windowIndex}-${colorIndex}`
    const existing = cache.get(key)
    if (existing) return existing
    const material = (mat.windows(windowIndex) as THREE.MeshLambertMaterial).clone()
    material.color = new THREE.Color(PALETTE.buildings[colorIndex % PALETTE.buildings.length])
    return standard(key, material)
  },

  roof: (index: number) => {
    const key = `roof-${index}`
    const existing = cache.get(key)
    if (existing) return existing
    return standard(key, new THREE.MeshLambertMaterial({ color: PALETTE.roofs[index % PALETTE.roofs.length] }))
  },

  toy: (colorIndex: number) => {
    const key = `toy-${colorIndex}`
    const existing = cache.get(key)
    if (existing) return existing
    return standard(
      key,
      new THREE.MeshLambertMaterial({
        color: PALETTE.rubber[colorIndex % PALETTE.rubber.length],
      }),
    )
  },

  car: (colorIndex: number) => {
    const key = `car-${colorIndex}`
    const existing = cache.get(key)
    if (existing) return existing
    return standard(
      key,
      new THREE.MeshLambertMaterial({ color: PALETTE.cars[colorIndex % PALETTE.cars.length] }),
    )
  },

  foliage: (index: number) => {
    const key = `foliage-${index}`
    const existing = cache.get(key)
    if (existing) return existing
    return standard(
      key,
      new THREE.MeshLambertMaterial({ color: PALETTE.foliage[index % PALETTE.foliage.length] }),
    )
  },

  headlight: () =>
    standard('headlight', new THREE.MeshBasicMaterial({ color: 0xfff6d0 })),

  rider: () => standard('rider', new THREE.MeshLambertMaterial({ color: PALETTE.rider })),

  helmet: () => standard('helmet', new THREE.MeshLambertMaterial({ color: PALETTE.helmet })),

  taillight: () =>
    standard('taillight', new THREE.MeshBasicMaterial({ color: 0xff5a4a })),

  lamp: () => standard('lamp', new THREE.MeshBasicMaterial({ color: 0xfff1c9 })),

  benchWood: () =>
    standard('benchWood', new THREE.MeshLambertMaterial({ color: 0x8a5a3b })),

  crateFrame: () =>
    standard('crateFrame', new THREE.MeshLambertMaterial({ color: 0x9a7038 })),
}

function makeWindowTexture(index: number): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const litChance = [0.1, 0.22, 0.05][index % 3]
  const glass = ['#7d8fa6', '#5f7089', '#93a6bd'][index % 3]

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = glass
  ctx.fillRect(size * 0.16, size * 0.14, size * 0.68, size * 0.72)

  ctx.fillStyle = '#fff3cd'
  if (litChance > 0) {
    const rng = mulberryLite(index * 977 + 13)
    if (rng() < litChance) {
      ctx.fillStyle = '#ffe9a8'
      ctx.fillRect(size * 0.16, size * 0.14, size * 0.68, size * 0.72)
    }
  }

  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(0, size * 0.86, size, size * 0.14)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.NearestFilter
  return texture
}

function mulberryLite(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
