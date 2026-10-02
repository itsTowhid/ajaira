import * as THREE from 'three'

const MAX_DROPS = 240
const GRAVITY = 9.4

interface Droplet {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  size: number
  r: number
  g: number
  b: number
}

export class Juice {
  private readonly mesh: THREE.InstancedMesh
  private readonly drops: Droplet[] = []
  private readonly dummy = new THREE.Object3D()
  private readonly tint = new THREE.Color()

  constructor(parent: THREE.Object3D) {
    const geometry = new THREE.SphereGeometry(1, 8, 6)
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.94,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_DROPS)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    for (let i = 0; i < MAX_DROPS; i++) this.mesh.setColorAt(i, this.tint.setHex(0xffffff))
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
      this.mesh.instanceColor.needsUpdate = true
    }
    parent.add(this.mesh)
  }

  burst(origin: THREE.Vector3, direction: THREE.Vector3, count: number, color: number): void {
    this.tint.setHex(color)
    for (let i = 0; i < count; i++) {
      if (this.drops.length >= MAX_DROPS) break
      const speed = 0.7 + Math.random() * 1.6
      const spread = (Math.random() - 0.5) * 1.1
      const life = 0.7 + Math.random() * 0.6
      this.drops.push({
        x: origin.x + (Math.random() - 0.5) * 0.1,
        y: origin.y + Math.random() * 0.15,
        z: origin.z + (Math.random() - 0.5) * 0.1,
        vx: direction.x * speed + spread * -direction.z,
        vy: 1.8 + Math.random() * 2.4,
        vz: direction.z * speed + spread * direction.x,
        life,
        max: life,
        size: 0.024 + Math.random() * 0.04,
        r: this.tint.r,
        g: this.tint.g,
        b: this.tint.b,
      })
    }
  }

  update(dt: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i]
      drop.vy -= GRAVITY * dt
      drop.x += drop.vx * dt
      drop.y += drop.vy * dt
      drop.z += drop.vz * dt
      if (drop.y < drop.size) {
        drop.y = drop.size
        drop.vy *= -0.3
        drop.vx *= 0.7
        drop.vz *= 0.7
      }
      drop.life -= dt
      if (drop.life <= 0) this.drops.splice(i, 1)
    }

    this.mesh.count = this.drops.length
    if (this.drops.length === 0) return

    for (let i = 0; i < this.drops.length; i++) {
      const drop = this.drops[i]
      const fade = Math.min(1, drop.life / 0.22) * Math.min(1, (drop.max - drop.life) / 0.05)
      this.dummy.position.set(drop.x, drop.y, drop.z)
      this.dummy.scale.setScalar(drop.size * fade)
      this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.mesh.setColorAt(i, this.tint.setRGB(drop.r, drop.g, drop.b))
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    const material = this.mesh.material
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
    else material.dispose()
    this.mesh.dispose()
    this.drops.length = 0
  }
}

interface Flash {
  mesh: THREE.Mesh
  life: number
  max: number
}

const flashGeometry = new THREE.PlaneGeometry(1, 1)

export class CutFlashes {
  private readonly flashes: Flash[] = []
  private readonly parent: THREE.Object3D

  constructor(parent: THREE.Object3D) {
    this.parent = parent
  }

  spawn(anchor: THREE.Vector3, angle: number, radius: number, color: number, height: number): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(flashGeometry, material)
    mesh.position.set(
      anchor.x + Math.cos(angle) * radius * 0.5,
      height * 0.5,
      anchor.z + Math.sin(angle) * radius * 0.5,
    )
    mesh.scale.set(radius, height, 1)
    mesh.rotation.y = -angle
    this.parent.add(mesh)
    this.flashes.push({ mesh, life: 0.32, max: 0.32 })
  }

  update(dt: number): void {
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]
      flash.life -= dt
      if (flash.life <= 0) {
        flash.mesh.removeFromParent()
        const material = flash.mesh.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material.dispose()
        this.flashes.splice(i, 1)
        continue
      }
      const t = flash.life / flash.max
      const material = flash.mesh.material as THREE.MeshBasicMaterial
      material.opacity = t * t * 0.9
    }
  }
}
