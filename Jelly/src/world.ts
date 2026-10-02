import * as THREE from 'three'
import { CutFlashes, Juice } from './effects'
import { FRUITS, fruitSeeds, layoutFor, type Seed } from './fruits'
import { JellyPiece, tickJelly } from './jelly'
import { solveContacts, type Body } from './physics'
import { clamp, randomRange, wrapAngle } from './util'
import { slabHeight } from './wedge'

const MIN_SPAN = 0.16
const MAX_PIECES = 18
const POKE_STRENGTH = 2.4
const PLATE_RADIUS = 5.6
const GAP = 0.065
const SOLVER_ITERATIONS = 3

export type CutResult = 'cut' | 'poke' | 'limit' | 'miss'

interface Drag {
  piece: JellyPiece
  plane: THREE.Plane
  offsetX: number
  offsetZ: number
}

function isDescendant(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object
  while (node) {
    if (node === root) return true
    node = node.parent
  }
  return false
}

export class World {
  readonly group = new THREE.Group()

  private readonly pieces: JellyPiece[] = []
  private readonly seedsByFruit = new Map<string, Seed[]>()
  private readonly flashes: CutFlashes
  private readonly juice: Juice
  private readonly planePoint = new THREE.Vector3()
  private cuts = 0
  private waveIndex = -1
  private waveTimer = 0
  private drag: Drag | null = null

  constructor() {
    this.flashes = new CutFlashes(this.group)
    this.juice = new Juice(this.group)
    this.reset()
  }

  get pieceCount(): number {
    return this.pieces.length
  }

  get cutCount(): number {
    return this.cuts
  }

  get dragging(): boolean {
    return this.drag !== null
  }

  reset(): void {
    for (const piece of this.pieces) piece.dispose()
    this.pieces.length = 0
    this.seedsByFruit.clear()
    this.cuts = 0
    this.waveIndex = -1
    this.drag = null

    FRUITS.forEach((fruit, index) => {
      const slot = layoutFor(index, FRUITS.length, fruit.span)
      const seeds = fruitSeeds(fruit, slot)
      this.seedsByFruit.set(fruit.id, seeds)

      const piece = new JellyPiece(
        fruit,
        slot.base,
        slot.start,
        slot.end,
        new THREE.Vector3(slot.anchorX, 0, slot.anchorZ),
        seeds,
      )
      this.pieces.push(piece)
      this.group.add(piece.group)
    })
  }

  wobble(): void {
    this.waveIndex = 0
    this.waveTimer = 0
  }

  hitTest(raycaster: THREE.Raycaster): boolean {
    return this.pick(raycaster) !== null
  }

  beginDrag(raycaster: THREE.Raycaster): boolean {
    const hit = this.pick(raycaster)
    if (!hit) return false

    this.drag = {
      piece: hit.piece,
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y),
      offsetX: hit.point.x - hit.piece.anchor.x,
      offsetZ: hit.point.z - hit.piece.anchor.z,
    }
    hit.piece.velocity.x = 0
    hit.piece.velocity.z = 0
    hit.piece.fixed = true
    return true
  }

  dragTo(raycaster: THREE.Raycaster, dt: number): void {
    const drag = this.drag
    if (!drag) return
    if (!raycaster.ray.intersectPlane(drag.plane, this.planePoint)) return

    const piece = drag.piece
    const targetX = this.planePoint.x - drag.offsetX
    const targetZ = this.planePoint.z - drag.offsetZ
    const alpha = 1 - Math.exp(-26 * dt)
    const nextX = piece.anchor.x + (targetX - piece.anchor.x) * alpha
    const nextZ = piece.anchor.z + (targetZ - piece.anchor.z) * alpha

    piece.velocity.x = (nextX - piece.anchor.x) / Math.max(dt, 1e-3)
    piece.velocity.z = (nextZ - piece.anchor.z) / Math.max(dt, 1e-3)
    piece.moveTo(nextX, nextZ)
    this.clampPiece(piece)
    piece.poke(Math.min(2.2, Math.hypot(piece.velocity.x, piece.velocity.z) * 0.35))
  }

  endDrag(): void {
    const drag = this.drag
    if (!drag) return
    const speed = Math.hypot(drag.piece.velocity.x, drag.piece.velocity.z)
    drag.piece.velocity.x = clamp(drag.piece.velocity.x, -7, 7)
    drag.piece.velocity.z = clamp(drag.piece.velocity.z, -7, 7)
    drag.piece.poke(clamp(0.6 + speed * 1.4, 0.6, 3.4))
    drag.piece.fixed = false
    this.drag = null
  }

  handlePointer(raycaster: THREE.Raycaster): CutResult {
    const hit = this.pick(raycaster)
    if (!hit) return 'miss'
    const piece = hit.piece

    const dx = hit.point.x - piece.anchor.x
    const dz = hit.point.z - piece.anchor.z
    const radius = Math.hypot(dx, dz)
    if (radius < 0.36) {
      piece.poke(POKE_STRENGTH)
      return 'poke'
    }

    const mid = (piece.start + piece.end) / 2
    const angle = mid + wrapAngle(Math.atan2(dz, dx) - mid)
    if (this.pieces.length >= MAX_PIECES) {
      piece.poke(POKE_STRENGTH)
      return 'limit'
    }
    if (angle - piece.start < MIN_SPAN || piece.end - angle < MIN_SPAN) {
      piece.poke(POKE_STRENGTH)
      return 'poke'
    }

    this.split(piece, angle)
    return 'cut'
  }

  update(dt: number): void {
    tickJelly(dt)

    if (this.waveIndex >= 0) {
      this.waveTimer -= dt
      if (this.waveTimer <= 0) {
        const piece = this.pieces[this.waveIndex]
        if (piece) piece.poke(randomRange(2.6, 3.6))
        this.waveIndex += 1
        this.waveTimer = 0.055
        if (this.waveIndex >= this.pieces.length) this.waveIndex = -1
      }
    }

    for (const piece of this.pieces) {
      if (this.drag && this.drag.piece === piece) continue
      piece.integrate(dt)
      this.clampPiece(piece)
    }

    solveContacts(this.pieces, GAP, SOLVER_ITERATIONS, (body) => this.clampPiece(body))

    for (const piece of this.pieces) piece.update(dt)
    this.juice.update(dt)
    this.flashes.update(dt)
  }

  private clampPiece(piece: Body): void {
    const limit = PLATE_RADIUS - 0.2
    let worst = 0
    let nx = 0
    let nz = 0
    for (const point of piece.worldFootprint) {
      const distance = Math.hypot(point.x, point.z)
      if (distance > worst) {
        worst = distance
        nx = point.x / distance
        nz = point.z / distance
      }
    }
    if (worst <= limit) return

    const push = worst - limit
    piece.anchor.x -= nx * push
    piece.anchor.z -= nz * push
    const outward = piece.velocity.x * nx + piece.velocity.z * nz
    if (outward > 0) {
      piece.velocity.x -= nx * outward
      piece.velocity.z -= nz * outward
    }
    piece.syncFootprint()
  }

  private pick(raycaster: THREE.Raycaster): { piece: JellyPiece; point: THREE.Vector3 } | null {
    const hits = raycaster.intersectObjects(this.targets(), true)
    for (const hit of hits) {
      const piece = this.pieces.find((candidate) => isDescendant(hit.object, candidate.group))
      if (piece) return { piece, point: hit.point }
    }
    return null
  }

  private targets(): THREE.Object3D[] {
    return this.pieces.map((piece) => piece.group)
  }

  private split(piece: JellyPiece, angle: number): void {
    const index = this.pieces.indexOf(piece)
    const anchor = piece.anchor.clone()
    const fruit = piece.fruit
    const seeds = this.seedsByFruit.get(fruit.id) ?? []
    const nx = Math.sin(angle)
    const nz = -Math.cos(angle)
    const speed = randomRange(0.55, 0.95)
    const height = slabHeight(fruit.thickness)

    const left = new JellyPiece(fruit, piece.base, piece.start, angle, anchor, seeds)
    const right = new JellyPiece(fruit, piece.base, angle, piece.end, anchor, seeds)
    left.velocity.x = nx * speed
    left.velocity.z = nz * speed
    right.velocity.x = -nx * speed
    right.velocity.z = -nz * speed
    left.poke(randomRange(2.2, 3))
    right.poke(randomRange(2.2, 3))

    this.group.add(left.group)
    this.group.add(right.group)
    piece.dispose()
    this.pieces.splice(index, 1, left, right)

    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (let i = 0; i < 4; i++) {
      const radius = randomRange(0.6, fruit.radius * 0.95)
      const origin = new THREE.Vector3(
        anchor.x + cos * radius,
        height * randomRange(0.75, 1.05),
        anchor.z + sin * radius,
      )
      const direction = new THREE.Vector3(nx, randomRange(0.7, 1.3), nz)
      if (i % 2 === 1) direction.negate()
      this.juice.burst(origin, direction, 6, fruit.juice)
    }

    this.flashes.spawn(anchor, angle, fruit.radius, fruit.juice, height)
    this.cuts += 1
  }
}
