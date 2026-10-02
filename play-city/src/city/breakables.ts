import * as THREE from 'three'
import type { BreakableSpec, CityLayout } from './layout'
import { mat } from './materials'

const DEBRIS_CAPACITY = 900
const GRAVITY = 26
const GROUND = 0.08

interface Part {
  mesh: THREE.InstancedMesh
  index: number
}

interface PartSpec {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  /** Box dimensions in local space, multiplied by the breakable scale. */
  size: [number, number, number]
  /** Local offset from the breakable origin, rotated by its yaw. */
  offset: [number, number, number]
  tint?: number[]
  spin?: number
}

interface Part {
  mesh: THREE.InstancedMesh
  index: number
}

interface Debris {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  rx: number
  ry: number
  rz: number
  ax: number
  ay: number
  az: number
  sx: number
  sy: number
  sz: number
  color: THREE.Color
  life: number
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
const unitBox = new THREE.BoxGeometry(1, 1, 1)
const unitPole = new THREE.CylinderGeometry(0.5, 0.5, 1, 8)
const unitTrunk = new THREE.CylinderGeometry(0.5, 0.5, 1, 7)
const unitLeaf = new THREE.IcosahedronGeometry(0.5, 0)
const white = new THREE.MeshLambertMaterial({ color: 0xffffff })
const foliage = [0x4faa52, 0x5fbf62, 0x3f9a48]
const crates = [0xc08c4e, 0xb07a3e, 0xa96c34, 0xc99a5c]

function definitions(kind: BreakableSpec['kind']): PartSpec[] {
  if (kind === 'lamp') {
    return [
      { geometry: unitPole, material: mat.metal(), size: [0.24, 6.4, 0.24], offset: [0, 3.2, 0] },
      { geometry: unitBox, material: mat.lamp(), size: [1.6, 0.34, 0.9], offset: [0, 6.5, 0.9] },
      { geometry: unitPole, material: mat.metal(), size: [0.62, 0.32, 0.62], offset: [0, 0.16, 0] },
    ]
  }

  if (kind === 'bench') {
    return [
      { geometry: unitBox, material: mat.benchWood(), size: [2.2, 0.16, 0.7], offset: [0, 0.3, 0] },
      { geometry: unitBox, material: mat.benchWood(), size: [2.2, 0.7, 0.14], offset: [0, 0.58, -0.32] },
      { geometry: unitBox, material: mat.metal(), size: [2.3, 0.12, 0.16], offset: [0, 0.15, 0] },
    ]
  }

  if (kind === 'crate') {
    return [
      { geometry: unitBox, material: white, size: [1.6, 1.6, 1.6], offset: [0, 0.8, 0], tint: crates },
      { geometry: unitBox, material: mat.crateFrame(), size: [1.72, 0.12, 1.72], offset: [0, 1.62, 0] },
    ]
  }

  return [
    { geometry: unitTrunk, material: mat.trunk(), size: [0.42, 2.2, 0.42], offset: [0, 1.1, 0] },
    { geometry: unitLeaf, material: white, size: [3.1, 3.6, 3.1], offset: [0, 3.1, 0], tint: foliage },
    { geometry: unitLeaf, material: white, size: [2.3, 2.6, 2.3], offset: [0, 4.7, 0], tint: foliage, spin: 1.1 },
  ]
}

export class Breakables {
  readonly group = new THREE.Group()
  smashed = 0

  private parts = new Map<number, Part[]>()
  private debris: Debris[] = []
  private readonly debrisMesh: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()

  constructor(layout: CityLayout) {
    this.debrisMesh = new THREE.InstancedMesh(unitBox, white, DEBRIS_CAPACITY)
    this.debrisMesh.castShadow = true
    this.debrisMesh.frustumCulled = false
    this.debrisMesh.count = 0
    this.group.add(this.debrisMesh)

    this.build(layout.breakables)
  }

  private build(specs: BreakableSpec[]) {
    const colour = new THREE.Color()

    for (const kind of [...new Set(specs.map((spec) => spec.kind))]) {
      const subset = specs.filter((spec) => spec.kind === kind)

      for (const part of definitions(kind)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, subset.length)
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.frustumCulled = false

        subset.forEach((spec, index) => {
          const cos = Math.cos(spec.rotation)
          const sin = Math.sin(spec.rotation)
          const [ox, oy, oz] = part.offset
          this.dummy.position.set(
            spec.x + (ox * cos + oz * sin) * spec.scale,
            oy * spec.scale,
            spec.z + (-ox * sin + oz * cos) * spec.scale,
          )
          this.dummy.rotation.set(0, spec.rotation + (part.spin ?? 0), 0)
          this.dummy.scale.set(
            part.size[0] * spec.scale,
            part.size[1] * spec.scale,
            part.size[2] * spec.scale,
          )
          this.dummy.updateMatrix()
          mesh.setMatrixAt(index, this.dummy.matrix)
          if (part.tint) {
            mesh.setColorAt(index, colour.set(part.tint[spec.colorIndex % part.tint.length]))
          }

          const list = this.parts.get(spec.id) ?? []
          list.push({ mesh, index })
          this.parts.set(spec.id, list)
        })

        mesh.instanceMatrix.needsUpdate = true
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
        this.group.add(mesh)
      }
    }
  }

  break(spec: BreakableSpec, impactX: number, impactZ: number, pushX: number, pushZ: number) {
    const parts = this.parts.get(spec.id)
    if (!parts) return false
    for (const part of parts) {
      part.mesh.setMatrixAt(part.index, hidden)
      part.mesh.instanceMatrix.needsUpdate = true
    }
    this.smashed++

    const palette = debrisPalette(spec.kind)
    const count = spec.kind === 'tree' ? 9 : spec.kind === 'lamp' ? 7 : 6
    const dirX = spec.x - impactX
    const dirZ = spec.z - impactZ
    const length = Math.hypot(dirX, dirZ) || 1
    const colour = new THREE.Color()

    for (let i = 0; i < count; i++) {
      if (this.debris.length >= DEBRIS_CAPACITY) break
      const outward = 1.5 + Math.random() * 3.6
      const size = (0.28 + Math.random() * 0.5) * spec.scale
      this.debris.push({
        x: spec.x + (Math.random() - 0.5) * 1.5 * spec.scale,
        y: (spec.kind === 'tree' ? 1 + Math.random() * 3.2 : 0.5 + Math.random() * 1.5) * spec.scale,
        z: spec.z + (Math.random() - 0.5) * 1.5 * spec.scale,
        vx: (dirX / length) * outward + pushX + (Math.random() - 0.5) * 2.5,
        vy: 3 + Math.random() * 6,
        vz: (dirZ / length) * outward + pushZ + (Math.random() - 0.5) * 2.5,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        rz: Math.random() * Math.PI,
        ax: (Math.random() - 0.5) * 14,
        ay: (Math.random() - 0.5) * 14,
        az: (Math.random() - 0.5) * 14,
        sx: size,
        sy: size * (0.5 + Math.random()),
        sz: size * (0.5 + Math.random()),
        color: colour.clone().set(palette[Math.floor(Math.random() * palette.length)]),
        life: 4 + Math.random() * 3,
      })
    }
    return true
  }

  update(dt: number) {
    const step = Math.min(dt, 0.05)
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i]
      piece.life -= step
      if (piece.life <= 0) {
        this.debris.splice(i, 1)
        continue
      }

      piece.vy -= GRAVITY * step
      piece.x += piece.vx * step
      piece.y += piece.vy * step
      piece.z += piece.vz * step
      piece.rx += piece.ax * step
      piece.ry += piece.ay * step
      piece.rz += piece.az * step

      const floor = piece.sy / 2 + GROUND
      if (piece.y < floor) {
        piece.y = floor
        piece.vy = -piece.vy * 0.34
        piece.vx *= 0.72
        piece.vz *= 0.72
        piece.ax *= 0.5
        piece.az *= 0.5
      }

      const fade = Math.min(1, piece.life / 1.6)
      this.dummy.position.set(piece.x, piece.y, piece.z)
      this.dummy.rotation.set(piece.rx, piece.ry, piece.rz)
      this.dummy.scale.set(piece.sx * fade, piece.sy * fade, piece.sz * fade)
      this.dummy.updateMatrix()
      this.debrisMesh.setMatrixAt(i, this.dummy.matrix)
      this.debrisMesh.setColorAt(i, piece.color)
    }

    this.debrisMesh.count = this.debris.length
    this.debrisMesh.instanceMatrix.needsUpdate = true
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true
  }
}

function debrisPalette(kind: BreakableSpec['kind']) {
  if (kind === 'lamp') return [0xb8bcc4, 0xd8d2c8, 0xfff1c9]
  if (kind === 'tree') return [0x4faa52, 0x5fbf62, 0x8a5a3b, 0x3f9a48]
  if (kind === 'bench') return [0x8a5a3b, 0x6f4a30, 0xb8bcc4]
  return [0xc08c4e, 0xb07a3e, 0xa96c34, 0xc99a5c]
}
