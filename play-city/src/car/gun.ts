import * as THREE from 'three'
import { mat } from '../city/materials'

/** Seconds the muzzle flash stays lit. One or two frames at 60 fps. */
const FLASH_TTL = 0.07

/**
 * The little roof-mounted cannon every ride carries. Purely visual: it spins no
 * physics and owns no bullets — `combat/Bullets` does the flying, this only
 * shows *where* shots come from and goes flash when one leaves.
 *
 * Mount points are chosen per vehicle in `ToyCar`/`ToyBike` so the turret stays
 * inside the silhouette the chase camera actually sees (the bike rule: paint and
 * props on the centre line are invisible from behind).
 */
export class Gun {
  readonly group = new THREE.Group()

  private readonly flash: THREE.Mesh
  private readonly flashMaterial: THREE.MeshBasicMaterial
  private flashLeft = 0

  constructor() {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.14, 10), mat.metal())
    base.position.y = 0.07
    base.castShadow = true
    this.group.add(base)

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.62), mat.metal())
    barrel.position.set(0, 0.14, 0.32)
    barrel.castShadow = true
    this.group.add(barrel)

    // Additive blob at the muzzle; hidden until `flashMuzzle` fires it.
    this.flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd45e,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.flashMaterial)
    this.flash.position.set(0, 0.14, 0.72)
    this.flash.visible = false
    this.group.add(this.flash)
  }

  /** World-space muzzle point — where a bullet is born. */
  muzzle(into: THREE.Vector3): THREE.Vector3 {
    return this.flash.getWorldPosition(into)
  }

  /** Light the flash. Safe to call every shot; the timer just restarts. */
  flashMuzzle() {
    this.flash.visible = true
    this.flashLeft = FLASH_TTL
    this.flash.rotation.z = Math.random() * Math.PI
    const scale = 0.85 + Math.random() * 0.4
    this.flash.scale.setScalar(scale)
  }

  update(dt: number) {
    if (this.flashLeft <= 0) return
    this.flashLeft -= dt
    if (this.flashLeft <= 0) this.flash.visible = false
  }

  /**
   * Frees this gun's geometries and its private flash material. `mat.metal()`
   * comes from the shared cache and is never disposed.
   */
  dispose() {
    this.group.removeFromParent()
    this.flashMaterial.dispose()
    const geometries = new Set<THREE.BufferGeometry>()
    this.group.traverse((object) => {
      const geometry = (object as THREE.Mesh).geometry
      if (geometry) geometries.add(geometry)
    })
    for (const geometry of geometries) geometry.dispose()
  }
}
