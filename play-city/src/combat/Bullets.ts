import * as THREE from 'three'
import { BULLET_SPEED, BULLET_TTL_S } from '../net/protocol'
import type { BoxCollider, CircleCollider } from '../city/layout'

/**
 * Client-side ballistics. Bullets are straight-flying, short-lived tracers:
 * `BULLET_SPEED` units/s for `BULLET_TTL_S` seconds, then they die of old age.
 *
 * Who owns the damage: a bullet fired *by this client* that runs into a remote
 * car turns into a hit claim (`net/Presence.claimHit`), and the relay decides
 * the truth. Remote bullets only produce small blasts and, on the local car, a
 * red flash — their shooter's client does the claiming.
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

/** Expanding flash sphere at the heart of a blast. */
interface Flash {
  mesh: THREE.Mesh
  life: number
  maxLife: number
  from: number
  to: number
}

/** Flat shockwave ring sliding out across the ground. */
interface Ring {
  mesh: THREE.Mesh
  life: number
  maxLife: number
  from: number
  to: number
}

/** One tumbling chunk of blast debris. */
interface Debris {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  spin: THREE.Vector3
  life: number
  maxLife: number
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
const MAX_FLASHES = 16
const FLASH_TTL = 0.18
const MAX_RINGS = 16
const RING_TTL = 0.35
const MAX_DEBRIS = 64
const DEBRIS_TTL = 0.6
/** Debris falls back to the table at this rate. */
const DEBRIS_GRAVITY = 22

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
  private readonly flashGeometry = new THREE.SphereGeometry(1, 12, 10)
  private readonly flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff3d0,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  private readonly ringGeometry = new THREE.RingGeometry(0.85, 1, 40)
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffcf7a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  private readonly debrisGeometry = new THREE.BoxGeometry(0.38, 0.38, 0.38)
  private readonly debrisMaterial = new THREE.MeshLambertMaterial({ color: 0xff9a4a })
  private readonly flashes: Flash[] = []
  private readonly rings: Ring[] = []
  private readonly debris: Debris[] = []
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
   * Big explosion for a wrecked car: the small impact blast scaled x2.5 with
   * more debris. Purely cosmetic — the relay already decided who died.
   */
  blast(x: number, z: number) {
    this.detonate(x, z, 2.5, 16)
  }

  /**
   * One blast: a flash sphere that pops and fades, a shockwave ring sliding
   * out across the ground, and a burst of tumbling debris. `scale` grows every
   * radius; impacts call this small, wrecks call it big through `blast`.
   */
  private detonate(x: number, z: number, scale: number, chunks: number) {
    let flash = this.flashes.find((candidate) => !candidate.mesh.visible)
    if (!flash) {
      if (this.flashes.length >= MAX_FLASHES) return
      const mesh = new THREE.Mesh(this.flashGeometry, this.flashMaterial.clone())
      mesh.visible = false
      this.group.add(mesh)
      flash = { mesh, life: 0, maxLife: FLASH_TTL, from: 0.7, to: 2.2 }
      this.flashes.push(flash)
    }
    flash.mesh.position.set(x, 1.2, z)
    flash.maxLife = FLASH_TTL * (scale > 1 ? 1.6 : 1)
    flash.life = flash.maxLife
    flash.from = 0.7 * scale
    flash.to = 2.2 * scale
    flash.mesh.scale.setScalar(flash.from)
    ;(flash.mesh.material as THREE.MeshBasicMaterial).opacity = 1
    flash.mesh.visible = true

    let ring = this.rings.find((candidate) => !candidate.mesh.visible)
    if (!ring) {
      if (this.rings.length < MAX_RINGS) {
        const mesh = new THREE.Mesh(this.ringGeometry, this.ringMaterial.clone())
        mesh.rotation.x = -Math.PI / 2
        mesh.visible = false
        this.group.add(mesh)
        ring = { mesh, life: 0, maxLife: RING_TTL, from: 1, to: 6 }
        this.rings.push(ring)
      }
    }
    if (ring) {
      ring.mesh.position.set(x, 0.15, z)
      ring.maxLife = RING_TTL * (scale > 1 ? 1.6 : 1)
      ring.life = ring.maxLife
      ring.from = 1 * scale
      ring.to = 6 * scale
      ring.mesh.scale.setScalar(ring.from)
      ;(ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85
      ring.mesh.visible = true
    }

    for (let i = 0; i < chunks; i++) {
      let chunk = this.debris.find((candidate) => !candidate.mesh.visible)
      if (!chunk) {
        if (this.debris.length >= MAX_DEBRIS) break
        const material = this.debrisMaterial.clone()
        material.color.setHex([0xff9a4a, 0xffd45e, 0x8a8f99][this.debris.length % 3])
        material.transparent = true
        const mesh = new THREE.Mesh(this.debrisGeometry, material)
        mesh.visible = false
        this.group.add(mesh)
        chunk = { mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, maxLife: DEBRIS_TTL }
        this.debris.push(chunk)
      }
      const angle = Math.random() * Math.PI * 2
      const outward = (3 + Math.random() * 6) * scale
      chunk.vel.set(Math.cos(angle) * outward, (5 + Math.random() * 6) * scale, Math.sin(angle) * outward)
      chunk.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14)
      chunk.mesh.position.set(x, 1.1, z)
      chunk.mesh.scale.setScalar(scale * (0.7 + Math.random() * 0.7))
      chunk.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0)
      ;(chunk.mesh.material as THREE.MeshLambertMaterial).opacity = 1
      chunk.maxLife = DEBRIS_TTL * (scale > 1 ? 1.5 : 1)
      chunk.life = chunk.maxLife
      chunk.mesh.visible = true
    }
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

      // Sub-step so a 420 u/s bullet cannot tunnel through a 1.8 u lamp
      // collider in a single 16 ms frame: 420 * 0.003 advances ~1.26 units
      // per slice, kept under ~1.4 so no collider is ever skipped over.
      let remaining = dt
      while (remaining > 0 && bullet.ttl > 0) {
        const step = Math.min(remaining, 0.002)
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

    for (const flash of this.flashes) {
      if (!flash.mesh.visible) continue
      flash.life -= dt
      if (flash.life <= 0) {
        flash.mesh.visible = false
        continue
      }
      const t = 1 - flash.life / flash.maxLife
      const material = flash.mesh.material as THREE.MeshBasicMaterial
      material.opacity = 1 - t
      flash.mesh.scale.setScalar(flash.from + (flash.to - flash.from) * t)
    }

    for (const ring of this.rings) {
      if (!ring.mesh.visible) continue
      ring.life -= dt
      if (ring.life <= 0) {
        ring.mesh.visible = false
        continue
      }
      const t = 1 - ring.life / ring.maxLife
      const material = ring.mesh.material as THREE.MeshBasicMaterial
      material.opacity = 0.85 * (1 - t)
      ring.mesh.scale.setScalar(ring.from + (ring.to - ring.from) * t)
    }

    for (const chunk of this.debris) {
      if (!chunk.mesh.visible) continue
      chunk.life -= dt
      if (chunk.life <= 0) {
        chunk.mesh.visible = false
        continue
      }
      chunk.vel.y -= DEBRIS_GRAVITY * dt
      chunk.mesh.position.x += chunk.vel.x * dt
      chunk.mesh.position.y += chunk.vel.y * dt
      chunk.mesh.position.z += chunk.vel.z * dt
      // Chunks land on the table and stop, then fade out with the blast.
      if (chunk.mesh.position.y < 0.19) {
        chunk.mesh.position.y = 0.19
        chunk.vel.set(0, 0, 0)
        chunk.spin.multiplyScalar(1 - Math.min(1, 6 * dt))
      }
      chunk.mesh.rotation.x += chunk.spin.x * dt
      chunk.mesh.rotation.y += chunk.spin.y * dt
      chunk.mesh.rotation.z += chunk.spin.z * dt
      ;(chunk.mesh.material as THREE.MeshLambertMaterial).opacity = Math.min(1, (chunk.life / chunk.maxLife) * 2)
    }

    return this.frameHits
  }

  dispose() {
    this.group.removeFromParent()
    this.tracerGeometry.dispose()
    this.tracerMaterial.dispose()
    this.sparkGeometry.dispose()
    this.sparkMaterial.dispose()
    this.flashGeometry.dispose()
    this.flashMaterial.dispose()
    this.ringGeometry.dispose()
    this.ringMaterial.dispose()
    this.debrisGeometry.dispose()
    this.debrisMaterial.dispose()
    for (const spark of this.sparks) (spark.mesh.material as THREE.Material).dispose()
    for (const flash of this.flashes) (flash.mesh.material as THREE.Material).dispose()
    for (const ring of this.rings) (ring.mesh.material as THREE.Material).dispose()
    for (const chunk of this.debris) (chunk.mesh.material as THREE.Material).dispose()
    for (const bullet of this.bullets) bullet.mesh.geometry.dispose()
    this.bullets.length = 0
    this.sparks.length = 0
    this.flashes.length = 0
    this.rings.length = 0
    this.debris.length = 0
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

  /** Kill the bullet in a small blast: flash, ring, and a few chunks. */
  private impact(bullet: Bullet) {
    this.detonate(bullet.x, bullet.z, 1, 7)
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
