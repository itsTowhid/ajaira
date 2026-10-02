import * as THREE from 'three'
import { mulberry32, wrapAngle } from './util'
import { slabHeight } from './wedge'

export interface LayerSpec {
  inner: number
  outer: number
  color: number
  sideColor?: number
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
  wobble: number
  transmission?: number
  thickness?: number
  attenuationColor?: number
  emissive?: number
  sheen?: number
  sheenColor?: number
  lift?: number
}

export interface SegmentSpec {
  count: number
  color: number
  coreRadius: number
  halfWidth: number
  lift: number
}

export type SeedLayout = 'scatter' | 'ring' | 'core' | 'speckle' | 'none'

export interface SeedSpec {
  layout: SeedLayout
  count: number
  color: number
  size: number
  innerRadius: number
  outerRadius: number
  minGap: number
  alignRadial: boolean
}

export interface FruitSpec {
  id: string
  name: string
  radius: number
  thickness: number
  span: number
  juice: number
  layers: LayerSpec[]
  segments?: SegmentSpec
  seeds: SeedSpec
}

export interface Seed {
  x: number
  z: number
  yaw: number
  tilt: number
  size: number
}

export const RING_RADIUS = 1.95

export interface Slot {
  base: number
  anchorX: number
  anchorZ: number
  start: number
  end: number
}

export function layoutFor(index: number, count: number, span: number): Slot {
  const base = Math.PI / 2 + (index * Math.PI * 2) / count
  return {
    base,
    anchorX: Math.cos(base) * RING_RADIUS,
    anchorZ: Math.sin(base) * RING_RADIUS,
    start: base - span / 2,
    end: base + span / 2,
  }
}

const NO_SEEDS: SeedSpec = {
  layout: 'none',
  count: 0,
  color: 0x000000,
  size: 0,
  innerRadius: 0,
  outerRadius: 0,
  minGap: 0,
  alignRadial: false,
}

export const FRUITS: FruitSpec[] = [
  {
    id: 'watermelon',
    name: 'Watermelon',
    radius: 2.6,
    thickness: 0.58,
    span: 1.05,
    juice: 0xff2d4d,
    layers: [
      {
        inner: 0,
        outer: 2.14,
        color: 0xff3355,
        sideColor: 0xff5470,
        roughness: 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        transmission: 0.22,
        thickness: 0.5,
        attenuationColor: 0xff7085,
        emissive: 0x2a0009,
        sheen: 0.4,
        sheenColor: 0xff9fb0,
        wobble: 1,
      },
      { inner: 2.14, outer: 2.3, color: 0xeaf3cf, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35, wobble: 0.55 },
      { inner: 2.3, outer: 2.6, color: 0x2f7a34, roughness: 0.42, clearcoat: 0.75, clearcoatRoughness: 0.28, wobble: 0.38 },
    ],
    seeds: {
      layout: 'scatter',
      count: 12,
      color: 0x2a1a13,
      size: 1,
      innerRadius: 0.62,
      outerRadius: 1.72,
      minGap: 0.34,
      alignRadial: false,
    },
  },
  {
    id: 'orange',
    name: 'Orange',
    radius: 2.25,
    thickness: 0.55,
    span: 0.95,
    juice: 0xffab2e,
    layers: [
      {
        inner: 0.42,
        outer: 1.95,
        color: 0xffa92e,
        sideColor: 0xffc45e,
        roughness: 0.26,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        transmission: 0.26,
        thickness: 0.45,
        attenuationColor: 0xffce78,
        emissive: 0x2e1206,
        sheen: 0.35,
        sheenColor: 0xffd699,
        wobble: 1,
      },
      { inner: 0, outer: 0.42, color: 0xfdf1d6, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35, wobble: 0.6 },
      { inner: 1.95, outer: 2.08, color: 0xfdf1d6, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35, wobble: 0.5 },
      { inner: 2.08, outer: 2.25, color: 0xef7016, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.26, wobble: 0.34 },
    ],
    segments: { count: 13, color: 0xfff4dd, coreRadius: 0.44, halfWidth: 0.032, lift: 0.016 },
    seeds: NO_SEEDS,
  },
  {
    id: 'kiwi',
    name: 'Kiwi',
    radius: 2.1,
    thickness: 0.5,
    span: 1,
    juice: 0xa8cf42,
    layers: [
      { inner: 0, outer: 0.5, color: 0xf4f5dc, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.35, wobble: 0.6 },
      {
        inner: 0.5,
        outer: 1.92,
        color: 0x9dc93a,
        sideColor: 0xb8de5b,
        roughness: 0.22,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        transmission: 0.22,
        thickness: 0.45,
        attenuationColor: 0xc9e77a,
        emissive: 0x101a04,
        sheen: 0.35,
        sheenColor: 0xd8ef95,
        wobble: 1,
      },
      { inner: 1.92, outer: 2.1, color: 0x6b4f31, roughness: 0.78, clearcoat: 0.18, clearcoatRoughness: 0.65, wobble: 0.32 },
    ],
    seeds: {
      layout: 'ring',
      count: 6,
      color: 0x1c1410,
      size: 0.8,
      innerRadius: 0.86,
      outerRadius: 0.86,
      minGap: 0,
      alignRadial: true,
    },
  },
  {
    id: 'dragonfruit',
    name: 'Dragon fruit',
    radius: 2.3,
    thickness: 0.6,
    span: 0.95,
    juice: 0xff5fa2,
    layers: [
      {
        inner: 0,
        outer: 2.02,
        color: 0xfbf1f4,
        sideColor: 0xf7e2ea,
        roughness: 0.24,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        transmission: 0.14,
        thickness: 0.5,
        attenuationColor: 0xffd6e4,
        emissive: 0x2a1420,
        sheen: 0.3,
        sheenColor: 0xffd2e2,
        wobble: 1,
      },
      { inner: 2.02, outer: 2.3, color: 0xdd2f79, roughness: 0.38, clearcoat: 0.85, clearcoatRoughness: 0.22, wobble: 0.42 },
    ],
    seeds: {
      layout: 'speckle',
      count: 44,
      color: 0x231014,
      size: 0.72,
      innerRadius: 0.32,
      outerRadius: 1.82,
      minGap: 0.13,
      alignRadial: false,
    },
  },
  {
    id: 'apple',
    name: 'Apple',
    radius: 2.3,
    thickness: 0.55,
    span: 1,
    juice: 0xf3e3ab,
    layers: [
      {
        inner: 0,
        outer: 2.06,
        color: 0xf7ebc2,
        sideColor: 0xfdf6dd,
        roughness: 0.28,
        clearcoat: 0.9,
        clearcoatRoughness: 0.14,
        transmission: 0.1,
        thickness: 0.45,
        attenuationColor: 0xfff2c9,
        emissive: 0x2a230e,
        sheen: 0.3,
        sheenColor: 0xfff0bd,
        wobble: 1,
      },
      { inner: 2.06, outer: 2.3, color: 0xbe3327, roughness: 0.32, clearcoat: 0.95, clearcoatRoughness: 0.18, wobble: 0.4 },
    ],
    seeds: {
      layout: 'core',
      count: 3,
      color: 0x3b2414,
      size: 1.3,
      innerRadius: 0.3,
      outerRadius: 0.56,
      minGap: 0.16,
      alignRadial: false,
    },
  },
]

const seedGeometry = new THREE.SphereGeometry(1, 10, 8)
const seedMaterials = new Map<number, THREE.MeshStandardMaterial>()

function seedMaterial(color: number): THREE.MeshStandardMaterial {
  let material = seedMaterials.get(color)
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.36, metalness: 0 })
    seedMaterials.set(color, material)
  }
  return material
}

function seedSlots(fruit: FruitSpec, slot: Slot): Seed[] {
  const spec = fruit.seeds
  if (spec.layout === 'none') return []

  const random = mulberry32(1000 + fruit.id.length * 977 + Math.round(fruit.radius * 1000))
  const margin = 0.14
  const inner = Math.min(spec.innerRadius, spec.outerRadius)
  const outer = Math.max(spec.innerRadius, spec.outerRadius)
  const seeds: Seed[] = []

  const push = (radius: number, angle: number, aligned: boolean): void => {
    seeds.push({
      x: slot.anchorX + Math.cos(angle) * radius,
      z: slot.anchorZ + Math.sin(angle) * radius,
      yaw: aligned ? -angle : random() * Math.PI,
      tilt: spec.layout === 'ring' ? 0 : (random() - 0.5) * 0.3,
      size: 0.9 + random() * 0.3,
    })
  }

  if (spec.layout === 'ring') {
    const radius = inner
    for (let i = 0; i < spec.count; i++) {
      const t = spec.count === 1 ? 0.5 : i / (spec.count - 1)
      const angle = slot.start + margin + t * (fruit.span - margin * 2)
      push(radius, angle, spec.alignRadial)
    }
    return seeds
  }

  if (spec.layout === 'core') {
    for (let i = 0; i < spec.count; i++) {
      const t = spec.count === 1 ? 0.5 : i / (spec.count - 1)
      const angle = slot.base + (t - 0.5) * 0.34
      const radius = inner + (outer - inner) * (0.35 + random() * 0.6)
      seeds.push({
        x: slot.anchorX + Math.cos(angle) * radius,
        z: slot.anchorZ + Math.sin(angle) * radius,
        yaw: -angle + (random() - 0.5) * 0.5,
        tilt: (random() - 0.5) * 0.35,
        size: 0.9 + random() * 0.25,
      })
    }
    return seeds
  }

  const minGap = spec.minGap
  const attempts = spec.count * 24
  for (let attempt = 0; attempt < attempts && seeds.length < spec.count; attempt++) {
    const angle = slot.start + margin + random() * (fruit.span - margin * 2)
    const radius = Math.sqrt(inner * inner + random() * (outer * outer - inner * inner))
    const x = slot.anchorX + Math.cos(angle) * radius
    const z = slot.anchorZ + Math.sin(angle) * radius
    if (seeds.some((seed) => Math.hypot(seed.x - x, seed.z - z) < minGap)) continue
    seeds.push({
      x,
      z,
      yaw: random() * Math.PI,
      tilt: (random() - 0.5) * 0.3,
      size: 0.9 + random() * 0.3,
    })
  }
  return seeds
}

export function fruitSeeds(fruit: FruitSpec, slot: Slot): Seed[] {
  return seedSlots(fruit, slot)
}

export function buildSeeds(
  fruit: FruitSpec,
  pool: readonly Seed[],
  anchorX: number,
  anchorZ: number,
  start: number,
  end: number,
): THREE.InstancedMesh | null {
  if (pool.length === 0) return null

  const placed: Array<{ seed: Seed; x: number; z: number }> = []
  const mid = (start + end) / 2
  for (const seed of pool) {
    const x = seed.x - anchorX
    const z = seed.z - anchorZ
    const radius = Math.hypot(x, z)
    if (radius < 0.2) continue
    const angle = mid + wrapAngle(Math.atan2(z, x) - mid)
    if (angle < start || angle > end) continue
    if (radius * Math.sin(angle - start) < 0.07) continue
    if (radius * Math.sin(end - angle) < 0.07) continue
    placed.push({ seed, x, z })
  }

  if (placed.length === 0) return null

  const mesh = new THREE.InstancedMesh(seedGeometry, seedMaterial(fruit.seeds.color), placed.length)
  mesh.castShadow = true
  const dummy = new THREE.Object3D()
  const scale = fruit.seeds.size
  placed.forEach(({ seed, x, z }, index) => {
    dummy.position.set(x, slabHeight(fruit.thickness) - 0.014, z)
    dummy.rotation.set(seed.tilt, seed.yaw, 0)
    dummy.scale.set(0.055 * seed.size * scale, 0.021 * seed.size * scale, 0.036 * seed.size * scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
  })
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}
