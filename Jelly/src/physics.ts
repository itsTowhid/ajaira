export interface Vec2 {
  x: number
  z: number
}

export function makeFootprint(
  start: number,
  end: number,
  radius: number,
  samples: number,
): Vec2[] {
  const points: Vec2[] = [{ x: 0, z: 0 }]
  for (let i = 0; i <= samples; i++) {
    const angle = start + (end - start) * (i / samples)
    points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius })
  }
  return points
}

export function toWorld(local: readonly Vec2[], anchorX: number, anchorZ: number, out: Vec2[]): Vec2[] {
  while (out.length < local.length) out.push({ x: 0, z: 0 })
  out.length = local.length
  for (let i = 0; i < local.length; i++) {
    out[i].x = local[i].x + anchorX
    out[i].z = local[i].z + anchorZ
  }
  return out
}

export interface Contact {
  ax: number
  az: number
  depth: number
}

interface Interval {
  min: number
  max: number
}

function project(poly: readonly Vec2[], ax: number, az: number, out: Interval): Interval {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < poly.length; i++) {
    const d = poly[i].x * ax + poly[i].z * az
    if (d < min) min = d
    if (d > max) max = d
  }
  out.min = min
  out.max = max
  return out
}

const intervalA: Interval = { min: 0, max: 0 }
const intervalB: Interval = { min: 0, max: 0 }

function centroid(poly: readonly Vec2[]): Vec2 {
  let x = 0
  let z = 0
  for (const point of poly) {
    x += point.x
    z += point.z
  }
  return { x: x / poly.length, z: z / poly.length }
}

export function contact(a: readonly Vec2[], b: readonly Vec2[], gap: number): Contact | null {
  let depth = Infinity
  let ax = 0
  let az = 0

  for (let pass = 0; pass < 2; pass++) {
    const poly = pass === 0 ? a : b
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i]
      const p2 = poly[i === poly.length - 1 ? 0 : i + 1]
      const ex = p2.x - p1.x
      const ez = p2.z - p1.z
      const length = Math.hypot(ex, ez)
      if (length < 1e-6) continue

      const nx = -ez / length
      const nz = ex / length

      const projA = project(a, nx, nz, intervalA)
      const projB = project(b, nx, nz, intervalB)
      const overlap = Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min)
      if (overlap <= -gap) return null
      if (overlap < depth) {
        depth = overlap
        ax = nx
        az = nz
      }
    }
  }

  const centerA = centroid(a)
  const centerB = centroid(b)
  if ((centerB.x - centerA.x) * ax + (centerB.z - centerA.z) * az < 0) {
    ax = -ax
    az = -az
  }

  return { ax, az, depth: depth + gap }
}

export interface Body {
  readonly anchor: { x: number; z: number }
  readonly velocity: Vec2
  readonly worldFootprint: Vec2[]
  readonly mass: number
  fixed: boolean
  syncFootprint(): void
  poke(amount: number): void
}

export function solveContacts(
  bodies: readonly Body[],
  gap: number,
  iterations: number,
  constrain?: (body: Body) => void,
): void {
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const body of bodies) body.syncFootprint()

    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]
        const result = contact(a.worldFootprint, b.worldFootprint, gap)
        if (!result) continue

        const total = a.mass + b.mass
        const weightA = a.fixed ? 0 : b.fixed ? 1 : b.mass / total
        const weightB = b.fixed ? 0 : a.fixed ? 1 : a.mass / total

        a.anchor.x -= result.ax * result.depth * weightA
        a.anchor.z -= result.az * result.depth * weightA
        b.anchor.x += result.ax * result.depth * weightB
        b.anchor.z += result.az * result.depth * weightB
        a.syncFootprint()
        b.syncFootprint()

        const approach =
          (b.velocity.x - a.velocity.x) * result.ax + (b.velocity.z - a.velocity.z) * result.az
        if (approach < -0.12) {
          const bump = Math.min(1.1, -approach * 0.7)
          a.poke(bump)
          b.poke(bump)
        }

        const alongA = a.velocity.x * result.ax + a.velocity.z * result.az
        if (alongA > 0) {
          a.velocity.x -= result.ax * alongA
          a.velocity.z -= result.az * alongA
        }
        const alongB = b.velocity.x * result.ax + b.velocity.z * result.az
        if (alongB < 0) {
          b.velocity.x -= result.ax * alongB
          b.velocity.z -= result.az * alongB
        }
      }
    }

    if (constrain) for (const body of bodies) constrain(body)
  }
}
