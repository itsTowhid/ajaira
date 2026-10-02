import * as THREE from 'three'

export interface GalaxyOptions {
  /** Total number of particles. */
  count?: number
  /** Disc radius in world units. */
  radius?: number
  /** Number of spiral arms. */
  arms?: number
  /** How tightly the arms wind. Higher = more turns outward. */
  spin?: number
  seed?: number
}

type Rng = () => number

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller gaussian, cached pair. */
function makeGauss(rng: Rng) {
  return (sigma = 1) => {
    const u = Math.max(rng(), 1e-7)
    const v = rng()
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

const c = (hex: number) => new THREE.Color(hex)

// Tight pink -> purple palette: hot pink core, lilac mid tones, violet arms.
const CORE_HOT = c(0xfff0f8)
const CORE_PINK = c(0xff9dd0)
const PINK = c(0xff8ec4)
const LILAC = c(0xe0b6ff)
const VIOLET = c(0xa98cff)
const DEEP_PURPLE = c(0x7d5cff)
const HII = c(0xff5fae)
const DUST = c(0x2e1a38)
const HALO = c(0xa88fd0)

function mixInto(target: THREE.Color, a: THREE.Color, b: THREE.Color, t: number) {
  target.copy(a).lerp(b, t)
  return target
}

/**
 * Exponential radial profile mapped onto [0, extent]. An exponential disc has
 * no hard outer rim, so the galaxy fades into space instead of ending on a
 * visible edge.
 */
function exponentialRadius(u: number, extent: number, scale: number): number {
  return -scale * Math.log(1 - u * (1 - Math.exp(-extent / scale)))
}

/**
 * Procedural spiral galaxy: hot bulge, logarithmic spiral disc with young blue
 * arms, pink HII knots, dark dust lanes and a dim halo, returned as
 * position/colour/size attributes for a single additive Points draw call.
 */
export function buildGalaxyGeometry(options: GalaxyOptions = {}): THREE.BufferGeometry {
  const {
    count = 420_000,
    radius = 70,
    arms = 4,
    spin = 0.32,
    seed = 1337,
  } = options

  const rng = mulberry32(seed)
  const gauss = makeGauss(rng)

  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const twinkle = new Float32Array(count)

  const color = new THREE.Color()
  const armStep = (Math.PI * 2) / arms

  const BULGE = 0.07
  const DISC = 0.72
  const DUST_FRAC = 0.08
  // Whatever is left (13%) becomes halo stars.

  // Star-forming regions are placed first so their particle budget is reserved
  // and the bulk loop can fill the remainder.
  const hii: number[] = []
  const regionCount = Math.round(count * 0.012)
  for (let k = 0; k < regionCount; k++) {
    const clusterSize = 8 + Math.floor(rng() * 26)
    const r = exponentialRadius(rng(), radius * 0.9, radius * 0.34)
    const armIndex = Math.floor(rng() * arms)
    const theta = armIndex * armStep + Math.log(Math.max(r, 1e-3)) / spin + gauss(0.3) * 0.4
    const cx = r * Math.cos(theta)
    const cy = r * Math.sin(theta)
    const cz = gauss(radius * 0.006)
    const spread = radius * (0.008 + rng() * 0.016)
    const hotness = 0.2 + rng() * 0.5

    for (let j = 0; j < clusterSize; j++) {
      mixInto(color, VIOLET, HII, hotness).multiplyScalar(0.18 + Math.pow(rng(), 2) * 0.4)
      hii.push(
        cx + gauss(spread),
        cz + gauss(spread * 0.6),
        -cy - gauss(spread),
        color.r,
        color.g,
        color.b,
        0.7 + Math.pow(rng(), 1.5) * 2.0,
        rng() * Math.PI * 2,
      )
    }
  }

  const hiiCount = hii.length / 8
  const bulkCount = count - hiiCount

  for (let i = 0; i < bulkCount; i++) {
    const i3 = i * 3
    const roll = rng()
    let x = 0
    let y = 0
    let z = 0
    let size = 1

    if (roll < BULGE) {
      // Central bulge: flattened ellipsoid of pink-white stars.
      const rad = exponentialRadius(rng(), radius * 0.34, radius * 0.085)
      const theta = rng() * Math.PI * 2
      const phi = Math.acos(2 * rng() - 1)
      const flatten = 0.55
      x = rad * Math.sin(phi) * Math.cos(theta)
      y = rad * Math.sin(phi) * Math.sin(theta)
      z = rad * Math.cos(phi) * flatten
      mixInto(color, CORE_PINK, CORE_HOT, Math.pow(rng(), 2.4))
      const bright = Math.pow(rng(), 2.6)
      color.multiplyScalar(0.14 + bright * 0.34)
      size = 1.1 + bright * 2.4
    } else if (roll < BULGE + DISC) {
      // Disc: exponential radial profile, brightest towards the core.
      const r = exponentialRadius(rng(), radius, radius * 0.3)
      const armIndex = Math.floor(rng() * arms)
      const winding = armIndex * armStep + Math.log(Math.max(r, 1e-3)) / spin
      // Arms get blurrier and thinner as they leave the core.
      const scatter = 0.16 + 0.55 * (r / radius)
      // Some disc stars are spread evenly between the arms so the disc reads
      // as a continuous sheet rather than isolated strands.
      const inArm = rng() > 0.32
      const theta = inArm ? winding + gauss(scatter) * 0.42 : rng() * Math.PI * 2
      const thickness = radius * (0.012 + 0.03 * (r / radius))
      x = r * Math.cos(theta)
      y = r * Math.sin(theta)
      z = gauss(thickness)

      // Arm stars lean violet, inter-arm stars lean pink.
      const armness = inArm ? 1 - Math.min(1, Math.abs(gauss(0.9))) : 0
      const t = Math.min(1, armness * 0.75 + Math.pow(rng(), 1.3) * 0.45)
      if (t > 0.62) mixInto(color, VIOLET, DEEP_PURPLE, rng() * 0.6)
      else mixInto(color, PINK, LILAC, t * 1.2)

      const bright = Math.pow(rng(), 3.1)
      const dim = inArm ? 1 : 0.55
      color.multiplyScalar((0.12 + bright * 0.75) * dim)
      size = 0.55 + bright * 1.9
    } else if (roll < BULGE + DISC + DUST_FRAC) {
      // Dust lanes: dark, hugging the inner arms.
      const r = exponentialRadius(rng(), radius * 0.8, radius * 0.26)
      const armIndex = Math.floor(rng() * arms)
      const winding = armIndex * armStep + Math.log(Math.max(r, 1e-3)) / spin
      const theta = winding + gauss(0.28) * 0.5
      x = r * Math.cos(theta)
      y = r * Math.sin(theta)
      z = gauss(radius * 0.008) - radius * 0.004
      color.copy(DUST).multiplyScalar(0.02 + rng() * 0.05)
      size = 0.5 + rng() * 0.9
    } else {
      // Halo: sparse ancient stars in a wide, flattened spheroid.
      const rad = radius * (0.25 + 1.5 * Math.pow(rng(), 2.6))
      const theta = rng() * Math.PI * 2
      const phi = Math.acos(2 * rng() - 1)
      x = rad * Math.sin(phi) * Math.cos(theta)
      y = rad * Math.sin(phi) * Math.sin(theta)
      z = rad * Math.cos(phi) * 0.42
      color.copy(HALO).multiplyScalar(0.05 + Math.pow(rng(), 2) * 0.22)
      size = 0.5 + rng() * 0.8
    }

    positions[i3] = x
    positions[i3 + 1] = z
    positions[i3 + 2] = -y
    colors[i3] = color.r
    colors[i3 + 1] = color.g
    colors[i3 + 2] = color.b
    sizes[i] = size
    twinkle[i] = rng() * Math.PI * 2
  }

  // Copy the reserved star-forming particles into the tail of the buffers.
  for (let k = 0; k < hiiCount; k++) {
    const i = bulkCount + k
    const i3 = i * 3
    const h = k * 8
    positions[i3] = hii[h]
    positions[i3 + 1] = hii[h + 1]
    positions[i3 + 2] = hii[h + 2]
    colors[i3] = hii[h + 3]
    colors[i3 + 1] = hii[h + 4]
    colors[i3 + 2] = hii[h + 5]
    sizes[i] = hii[h + 6]
    twinkle[i] = hii[h + 7]
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** Distant background stars, so rotation reads as motion through space. */
export function buildStarfieldGeometry(count = 6000, extent = 900, seed = 7): THREE.BufferGeometry {
  const rng = mulberry32(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const twinkle = new Float32Array(count)
  const color = new THREE.Color()

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    const rad = extent * (0.6 + 0.4 * rng())
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    positions[i3] = rad * Math.sin(phi) * Math.cos(theta)
    positions[i3 + 1] = rad * Math.cos(phi)
    positions[i3 + 2] = rad * Math.sin(phi) * Math.sin(theta)

    const mag = Math.pow(rng(), 3.5)
    color.copy(HALO).lerp(PINK, rng() * 0.5).multiplyScalar(0.12 + mag * 0.6)
    colors[i3] = color.r
    colors[i3 + 1] = color.g
    colors[i3 + 2] = color.b
    sizes[i] = 0.5 + mag * 1.6
    twinkle[i] = rng() * Math.PI * 2
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkle, 1))
  return geometry
}
