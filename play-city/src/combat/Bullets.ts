import * as THREE from 'three'
import { BULLET_SPEED, BULLET_TTL_S } from '../net/protocol'
import type { BoxCollider, CircleCollider } from '../city/layout'

/**
 * Client-side ballistics. Bullets are straight-flying, short-lived tracers:
 * `BULLET_SPEED` units/s for `BULLET_TTL_S` seconds, then they die of old age.
 *
 * Who owns the damage: a bullet fired *by this client* that runs into a remote
 * car turns into a hit claim (`net/Presence.claimHit`), and the relay decides
 * the truth. Remote bullets only produce sparks and, on the local car, a red
 * flash — their shooter's client does the claiming.
 */

/** A remote-car collider with its roster id attached, for hit claims. */
export interface TargetCollider extends CircleCollider {
  remoteId?: string
}

interface Bullet {
  x: number
  z: number
  vx: number
  vz: number
  ttl: number
  /** True when this client should claim hits for this bullet. */
  mine: boolean
  mesh: THREE.Mesh
}

/** One animation-frame impact spark. */
interface Spark {
  mesh: THREE.Mesh
  life: number
}

export interface BulletHit {
  /** We shot this remote car; caller turns this into a hit claim. */
  remoteId: string | null
  /** Smashed scenery index, for `Breakables.break`. */
  breakable: number | null
  /** Bowled traffic index, for `Traffic.knock`. */
  trafficIndex: number | null
  /** The bullet (any shooter) connected with the local car. */
  local: boolean
  /** True when this bullet was fired by this client (only these claim hits). */
  mine: boolean
  /** Where the bullet connected, and which way it was travelling. */
  x: number
  z: number
  h: number
}

/** Bullets never live long enough to need more than this on screen. */
const MAX_BULLETS = 128
const MAX_SPARKS = 32
const SPARK_TTL = 0.22

export class Bullets {
  readonly group = new THREE.Group()

  private readonly bullets: Bullet[] = []
  private readonly sparks: Spark[] = []
  private readonly tracerGeometry = new THREE.BoxGeometry(0.14, 0.14, 1.5)
  private readonly tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd45e })
  private readonly sparkGeometry = new THREE.SphereGeometry(0.3, 6, 5)
  private readonly sparkMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe9a3,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  /** Reused per-frame result buffer; `update` clears it, callers just read it. */
  private readonly frameHits: BulletHit[] = []
  private readonly forward = new THREE.Vector3()

  /**
   * Fire from a world-space muzzle point along `heading` (+Z at 0, matching the
   * vehicles). `mine` marks bullets this client claims hits for.
   */
  spawn(x: number, z: number, heading: number, mine: boolean) {
    this.forward.set(Math.sin(heading), 0, Math.cos(heading))
    const bullet = this.acquire()
    bullet.x = x + this.forward.x * 0.9
    bullet.z = z + this.forward.z * 0.9
    bullet.vx = this.forward.x * BULLET_SPEED
    bullet.vz = this.forward.z * BULLET_SPEED
    bullet.ttl = BULLET_TTL_S
    bullet.mine = mine
    bullet.mesh.position.set(bullet.x, 1.25, bullet.z)
    bullet.mesh.rotation.y = heading
    bullet.mesh.visible = true
  }

  /** Muzzle flash made flesh: a spark even when nothing was hit. */
  spark(x: number, z: number, y = 1.1) {
    let spark = this.freeSpark()
    if (!spark) {
      if (this.sparks.length >= MAX_SPARKS) return
      const mesh = new THREE.Mesh(this.sparkGeometry, this.sparkMaterial.clone())
      mesh.visible = false
      this.group.add(mesh)
      spark = { mesh, life: 0 }
      this.sparks.push(spark)
    }
    spark.mesh.position.set(x, y, z)
    spark.mesh.scale.setScalar(0.7)
    ;(spark.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9
    spark.mesh.visible = true
    spark.life = SPARK_TTL
  }

  /**
   * Fly everything one frame. Hits are reported against `boxes`/`circles`
   * (buildings, props, traffic) and `targets` (live remote cars), plus the
   * local car circle when `localBody` is given. Dead remotes are ghosts.
   */
  update(
    dt: number,
    boxes: BoxCollider[],
    circles: CircleCollider[],
    targets: TargetCollider[],
    localBody: { x: number; z: number; r: number } | null,
  ): BulletHit[] {
    this.frameHits.length = 0

    for (const bullet of this.bullets) {
      if (!bullet.mesh.visible) continue

      // Sub-step so a 140 u/s bullet cannot tunnel through a 0.5 u lamp post
      // in a single 16 ms frame: never advance more than ~0.4 units per slice.
      let remaining = dt
      while (remaining > 0 && bullet.ttl > 0) {
        const step = Math.min(remaining, 0.003)
        remaining -= step
        bullet.x += bullet.vx * step
        bullet.z += bullet.vz * step
        bullet.ttl -= step
        if (this.collide(bullet, boxes, circles, targets, localBody)) break
      }

      if (bullet.ttl <= 0) {
        bullet.mesh.visible = false
        continue
      }
      bullet.mesh.position.set(bullet.x, 1.25, bullet.z)
    }

    for (const spark of this.sparks) {
      if (!spark.mesh.visible) continue
      spark.life -= dt
      if (spark.life <= 0) {
        spark.mesh.visible = false
        continue
      }
      const material = spark.mesh.material as THREE.MeshBasicMaterial
      material.opacity = (spark.life / SPARK_TTL) * 0.9
      spark.mesh.scale.setScalar(0.7 + (1 - spark.life / SPARK_TTL) * 1.3)
    }

    return this.frameHits
  }

  dispose() {
    this.group.removeFromParent()
    this.tracerGeometry.dispose()
    this.tracerMaterial.dispose()
    this.sparkGeometry.dispose()
    this.sparkMaterial.dispose()
    for (const spark of this.sparks) (spark.mesh.material as THREE.Material).dispose()
    for (const bullet of this.bullets) bullet.mesh.geometry.dispose()
    this.bullets.length = 0
    this.sparks.length = 0
  }

  private collide(
    bullet: Bullet,
    boxes: BoxCollider[],
    circles: CircleCollider[],
    targets: TargetCollider[],
    localBody: { x: number; z: number; r: number } | null,
  ): boolean {
    // Buildings, parked cars, props: an axis-aligned box vs a point.
    for (const box of boxes) {
      if (box.destroyed) continue
      if (Math.abs(bullet.x - box.x) > box.hw || Math.abs(bullet.z - box.z) > box.hd) continue
      if (box.breakable !== undefined) {
        box.destroyed = true
        this.frameHits.push({ remoteId: null, breakable: box.breakable, trafficIndex: null, local: false, mine: bullet.mine, x: bullet.x, z: bullet.z, h: Math.atan2(bullet.vx, bullet.vz) })
      }
      this.impact(bullet)
      return true
    }

    // Trees, lamps, benches, traffic: circles vs a point.
    for (const circle of circles) {
      if (circle.destroyed) continue
      const dx = bullet.x - circle.x
      const dz = bullet.z - circle.z
      if (dx * dx + dz * dz > circle.r * circle.r) continue
      if (circle.breakable !== undefined) {
        circle.destroyed = true
        this.frameHits.push({ remoteId: null, breakable: circle.breakable, trafficIndex: null, local: false, mine: bullet.mine, x: bullet.x, z: bullet.z, h: Math.atan2(bullet.vx, bullet.vz) })
      } else if (circle.trafficIndex !== undefined) {
        this.frameHits.push({ remoteId: null, breakable: null, trafficIndex: circle.trafficIndex, local: false, mine: bullet.mine, x: bullet.x, z: bullet.z, h: Math.atan2(bullet.vx, bullet.vz) })
      }
      this.impact(bullet)
      return true
    }

    // Live remote cars.
    for (const target of targets) {
      if (target.destroyed) continue
      const dx = bullet.x - target.x
      const dz = bullet.z - target.z
      const radius = target.r + 0.3
      if (dx * dx + dz * dz > radius * radius) continue
      this.frameHits.push({
        remoteId: target.remoteId ?? null,
        breakable: null,
        trafficIndex: null,
        local: false,
        mine: bullet.mine,
        x: bullet.x,
        z: bullet.z,
        h: Math.atan2(bullet.vx, bullet.vz),
      })
      this.impact(bullet)
      return true
    }

    // The local car eats incoming bullets at point blank. Own tracers are born
    // inside their own body circle, so they are exempt until they belong to
    // somebody else (they never come back — bullets fly straight).
    if (localBody && !bullet.mine) {
      const dx = bullet.x - localBody.x
      const dz = bullet.z - localBody.z
      const radius = localBody.r + 0.3
      if (dx * dx + dz * dz <= radius * radius) {
        this.frameHits.push({ remoteId: null, breakable: null, trafficIndex: null, local: true, mine: false, x: bullet.x, z: bullet.z, h: Math.atan2(bullet.vx, bullet.vz) })
        this.impact(bullet)
        return true
      }
    }

    return false
  }

  /** Kill the bullet in a spark. */
  private impact(bullet: Bullet) {
    this.spark(bullet.x, bullet.z, 1.25)
    bullet.ttl = 0
    bullet.mesh.visible = false
  }

  private acquire(): Bullet {
    const pooled = this.bullets.find((candidate) => !candidate.mesh.visible)
    if (pooled) return pooled
    if (this.bullets.length < MAX_BULLETS) {
      const mesh = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial)
      mesh.visible = false
      this.group.add(mesh)
      const bullet: Bullet = { x: 0, z: 0, vx: 0, vz: 0, ttl: 0, mine: false, mesh }
      this.bullets.push(bullet)
      return bullet
    }
    // Starved: recycle whichever bullet has the least life left.
    const oldest = this.bullets.reduce((a, b) => (a.ttl <= b.ttl ? a : b))
    return oldest
  }

  private freeSpark(): Spark | undefined {
    return this.sparks.find((spark) => !spark.mesh.visible)
  }
}
