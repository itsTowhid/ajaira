import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { cellToWorld } from './level'

export type PowerKind = 'bomb' | 'fire' | 'speed'

/** Deterministic drop so both net peers agree without extra sync. */
export function rollPower(cx: number, cz: number, seed = 7): PowerKind | null {
  const h = (cx * 73 + cz * 149 + seed * 31) % 10
  if (h <= 2) return 'bomb'
  if (h <= 5) return 'fire'
  if (h <= 7) return 'speed'
  return null
}

function glyph(kind: PowerKind): string {
  return kind === 'bomb' ? '●' : kind === 'fire' ? '▲' : '◆'
}

function glyphColor(kind: PowerKind): string {
  return kind === 'bomb' ? '#23262e' : kind === 'fire' ? '#e8590c' : '#1971c2'
}

export function makePowerMesh(kind: PowerKind): THREE.Group {
  const g = new THREE.Group()

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.26, 20),
    new THREE.MeshBasicMaterial({ color: 0x1d2b12, transparent: true, opacity: 0.22 }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.015
  g.add(shadow)

  const box = new THREE.Mesh(
    new RoundedBoxGeometry(0.56, 0.26, 0.56, 2, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xfff3cf, roughness: 0.5 }),
  )
  box.position.y = 0.15
  box.castShadow = true
  g.add(box)

  // floating icon
  let icon: THREE.Mesh
  if (kind === 'bomb') {
    icon = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.25, metalness: 0.3 }),
    )
  } else if (kind === 'fire') {
    icon = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.34, 16),
      new THREE.MeshStandardMaterial({ color: 0xff7b1c, emissive: 0x903c00, emissiveIntensity: 0.9, roughness: 0.4 }),
    )
  } else {
    icon = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.2, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x339af0, roughness: 0.35 }),
    )
    icon.rotation.z = Math.PI / 2.5
  }
  icon.position.y = 0.52
  icon.castShadow = true
  icon.name = 'icon'
  g.add(icon)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.03, 8, 24),
    new THREE.MeshBasicMaterial({ color: kind === 'fire' ? 0xff922b : kind === 'bomb' ? 0x868e96 : 0x4dabf7 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.52
  g.add(ring)

  // label sprite
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff3cf'
  ctx.beginPath(); ctx.arc(32, 32, 30, 0, Math.PI * 2); ctx.fill()
  ctx.lineWidth = 4; ctx.strokeStyle = '#9c5f1e'; ctx.stroke()
  ctx.fillStyle = glyphColor(kind)
  ctx.font = '900 34px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(glyph(kind), 32, 34)
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }),
  )
  label.scale.setScalar(0.42)
  label.position.y = 0.92
  g.add(label)

  g.userData.kind = kind
  return g
}

export function placePowerMesh(g: THREE.Group, cx: number, cz: number) {
  const { x, z } = cellToWorld(cx, cz)
  g.position.set(x, 0, z)
}
