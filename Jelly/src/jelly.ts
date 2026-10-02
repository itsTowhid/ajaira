import * as THREE from 'three'
import {
  buildSeeds,
  type FruitSpec,
  type LayerSpec,
  type Seed,
} from './fruits'
import { makeFootprint, toWorld, type Vec2 } from './physics'
import { clamp } from './util'
import { buildWedge } from './wedge'

const timeUniform = { value: 0 }
const ampUniform = { value: 0.055 }

const K_SQUASH = 260
const C_SQUASH = 6.2
const K_SWAY = 190
const C_SWAY = 5.4
const MAX_SQUASH = 0.34
const MAX_SWAY = 0.12
const DRAG = 3.4
const TAU = Math.PI * 2

export function tickJelly(dt: number): void {
  timeUniform.value += dt
}

interface JellyUniforms {
  phase: { value: number }
  boost: { value: number }
  span: { value: THREE.Vector2 }
  squash: { value: number }
  sway: { value: number }
}

function wobble<T extends THREE.MeshPhysicalMaterial>(
  material: T,
  uniforms: JellyUniforms,
  strength: number,
): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uJellyTime = timeUniform
    shader.uniforms.uJellyAmp = ampUniform
    shader.uniforms.uJellyPhase = uniforms.phase
    shader.uniforms.uJellyBoost = uniforms.boost
    shader.uniforms.uJellySpan = uniforms.span
    shader.uniforms.uJellySquash = uniforms.squash
    shader.uniforms.uJellySway = uniforms.sway
    shader.uniforms.uJellyStrength = { value: strength }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uJellyTime;
        uniform float uJellyAmp;
        uniform float uJellyPhase;
        uniform float uJellyBoost;
        uniform float uJellyStrength;
        uniform float uJellySquash;
        uniform float uJellySway;
        uniform vec2 uJellySpan;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float jellyRadius = length(position.xz);
        float jellyAngle = atan(position.z, position.x);
        float jellyMid = (uJellySpan.x + uJellySpan.y) * 0.5;
        float jellyDelta = jellyAngle - jellyMid;
        jellyDelta = atan(sin(jellyDelta), cos(jellyDelta));
        float jellyEdge = (uJellySpan.y - uJellySpan.x) * 0.5 - abs(jellyDelta);
        float jellyMask = smoothstep(0.0, 0.45, jellyRadius) * smoothstep(0.0, 0.34, jellyEdge);

        float jellyA = sin(position.x * 2.1 + uJellyTime * 2.4 + uJellyPhase);
        float jellyB = cos(position.z * 2.7 - uJellyTime * 3.1 + uJellyPhase * 0.8);
        float jellyC = sin((position.x + position.z) * 3.4 + uJellyTime * 4.6);
        float jellyGloop = sin(position.x * 0.9 + uJellyTime * 1.3)
          * cos(position.z * 0.8 - uJellyTime * 1.1 + uJellyPhase * 0.4);
        float jellyWave = jellyA * 0.45 + jellyB * 0.35 + jellyC * 0.22;
        float jellyAmp = uJellyAmp * uJellyStrength * uJellyBoost * jellyMask;

        transformed += normal * (jellyWave + jellyGloop * 0.7) * jellyAmp;
        transformed.xz += vec2(jellyB, jellyA) * jellyAmp * 0.4;

        vec2 jellySpread = vec2(
          1.0 - uJellySquash * 0.45 + uJellySway,
          1.0 - uJellySquash * 0.45 - uJellySway
        );
        transformed.xz *= mix(vec2(1.0), jellySpread, jellyMask);`,
      )
  }
  return material
}

function layerMaterial(layer: LayerSpec, uniforms: JellyUniforms, color: number): THREE.MeshPhysicalMaterial {
  const parameters: THREE.MeshPhysicalMaterialParameters = {
    color,
    metalness: 0,
    roughness: layer.roughness,
    clearcoat: layer.clearcoat,
    clearcoatRoughness: layer.clearcoatRoughness,
  }
  if (layer.transmission) {
    parameters.transmission = layer.transmission
    parameters.thickness = layer.thickness ?? 0.5
    parameters.ior = 1.36
    if (layer.attenuationColor !== undefined) parameters.attenuationColor = layer.attenuationColor
  }
  if (layer.emissive !== undefined) parameters.emissive = layer.emissive
  if (layer.sheen) {
    parameters.sheen = layer.sheen
    parameters.sheenColor = layer.sheenColor ?? 0xffffff
  }
  return wobble(new THREE.MeshPhysicalMaterial(parameters), uniforms, layer.wobble)
}

export class JellyPiece {
  readonly fruit: FruitSpec
  readonly group = new THREE.Group()
  readonly anchor = new THREE.Vector3()
  readonly velocity: Vec2 = { x: 0, z: 0 }
  readonly start: number
  readonly end: number

  readonly mass: number
  readonly footprint: Vec2[]
  readonly worldFootprint: Vec2[] = []
  readonly base: number
  fixed = false

  private readonly localPhase: number
  private readonly uniforms: JellyUniforms = {
    phase: { value: 0 },
    boost: { value: 1 },
    span: { value: new THREE.Vector2(0, 0) },
    squash: { value: 0 },
    sway: { value: 0 },
  }
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = []
  private seedMesh: THREE.InstancedMesh | null = null
  private squash = 0
  private squashVel = 0
  private sway = 0
  private swayVel = 0

  constructor(
    fruit: FruitSpec,
    base: number,
    start: number,
    end: number,
    anchor: THREE.Vector3,
    seeds: readonly Seed[],
  ) {
    this.fruit = fruit
    this.base = base
    this.start = start
    this.end = end
    this.anchor.copy(anchor)
    this.localPhase = Math.random() * Math.PI * 2
    this.uniforms.phase.value = this.localPhase
    this.uniforms.span.value.set(start, end)
    this.mass = Math.max(0.15, end - start)
    this.footprint = makeFootprint(start, end, fruit.radius + 0.05, 7)
    this.syncFootprint()

    for (const layer of fruit.layers) {
      const lift = layer.lift ?? 0
      const geometry = buildWedge(
        layer.inner,
        layer.outer,
        start,
        end,
        fruit.thickness + lift * 2,
      )
      if (lift > 0) geometry.translate(0, -lift, 0)
      const capMaterial = layerMaterial(layer, this.uniforms, layer.color)
      this.disposables.push(geometry, capMaterial)

      if (layer.sideColor !== undefined) {
        const sideMaterial = layerMaterial(layer, this.uniforms, layer.sideColor)
        this.disposables.push(sideMaterial)
        this.addMesh(new THREE.Mesh(geometry, [capMaterial, sideMaterial]))
      } else {
        this.addMesh(new THREE.Mesh(geometry, capMaterial))
      }
    }

    this.addSegments()
    this.seedMesh = buildSeeds(fruit, seeds, this.anchor.x, this.anchor.z, start, end)
    if (this.seedMesh) this.group.add(this.seedMesh)

    this.group.position.copy(this.anchor)
  }

  syncFootprint(): void {
    toWorld(this.footprint, this.anchor.x, this.anchor.z, this.worldFootprint)
  }

  moveTo(x: number, z: number): void {
    this.anchor.x = x
    this.anchor.z = z
    this.syncFootprint()
  }

  integrate(dt: number): void {
    this.anchor.x += this.velocity.x * dt
    this.anchor.z += this.velocity.z * dt
    const decay = Math.exp(-DRAG * dt)
    this.velocity.x *= decay
    this.velocity.z *= decay
    if (Math.abs(this.velocity.x) < 0.002) this.velocity.x = 0
    if (Math.abs(this.velocity.z) < 0.002) this.velocity.z = 0
    this.syncFootprint()
  }

  poke(strength: number): void {
    const amount = clamp(strength, 0, 4)
    this.squashVel += amount
    this.swayVel += (Math.random() < 0.5 ? -1 : 1) * amount * 0.55
  }

  update(dt: number): void {
    this.squashVel += (-K_SQUASH * this.squash - C_SQUASH * this.squashVel) * dt
    this.squash = clamp(this.squash + this.squashVel * dt, -MAX_SQUASH, MAX_SQUASH)

    this.swayVel += (-K_SWAY * this.sway - C_SWAY * this.swayVel) * dt
    this.sway = clamp(this.sway + this.swayVel * dt, -MAX_SWAY, MAX_SWAY)

    const time = timeUniform.value
    const breath = Math.sin(time * 1.7 + this.localPhase) * 0.022
    const swayBreath = Math.sin(time * 1.15 + this.localPhase * 1.7) * 0.028
    const squash = this.squash + breath
    const sway = this.sway + swayBreath

    this.uniforms.squash.value = squash
    this.uniforms.sway.value = sway
    this.uniforms.boost.value = Math.min(1.9, 1 + Math.abs(this.squash) * 4 + Math.abs(this.sway) * 4)

    this.group.scale.set(1, 1 + squash, 1)
    this.group.position.copy(this.anchor)
  }

  dispose(): void {
    this.group.removeFromParent()
    this.seedMesh?.dispose()
    this.seedMesh = null
    for (const disposable of this.disposables) disposable.dispose()
    this.disposables.length = 0
  }

  private addMesh(mesh: THREE.Mesh): void {
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
  }

  private addSegments(): void {
    const spec = this.fruit.segments
    if (!spec) return

    const step = TAU / spec.count
    const half = spec.halfWidth
    const outer = this.fleshRadius() - 0.01
    const material = wobble(
      new THREE.MeshPhysicalMaterial({
        color: spec.color,
        metalness: 0,
        roughness: 0.45,
        clearcoat: 0.5,
        clearcoatRoughness: 0.3,
      }),
      this.uniforms,
      0.6,
    )
    this.disposables.push(material)

    const first = Math.ceil((this.start + half - this.base) / step)
    const last = Math.floor((this.end - half - this.base) / step)
    for (let k = first; k <= last; k++) {
      const angle = this.base + k * step
      const geometry = buildWedge(
        spec.coreRadius,
        outer,
        angle - half,
        angle + half,
        this.fruit.thickness + spec.lift * 2,
      )
      geometry.translate(0, -spec.lift, 0)
      this.disposables.push(geometry)
      this.addMesh(new THREE.Mesh(geometry, material))
    }
  }

  private fleshRadius(): number {
    let radius = 0
    for (const layer of this.fruit.layers) {
      if (layer.sideColor !== undefined) radius = Math.max(radius, layer.outer)
    }
    if (radius > 0) return radius
    for (const layer of this.fruit.layers) radius = Math.max(radius, layer.outer)
    return radius
  }
}
