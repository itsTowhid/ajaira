import * as THREE from 'three'

/**
 * Floating name tags over remote vehicles. One sprite per driver, drawn on a
 * small canvas so text stays crisp and needs no font/scene plumbing. A tag
 * rides above its vehicle, always faces the camera (sprites do), hides at
 * distance, and fades in the last stretch so pop-in is soft.
 *
 * Combat added a health bar under the name. HP changes are rare (a few times
 * per duel, not per frame), so the canvas only redraws when the value moves.
 */

const CANVAS_W = 256
const CANVAS_H = 88
/** World-space height of the tag plane; width follows the text aspect. */
const TAG_HEIGHT = 1.3
/** Above the roof / rider's helmet. */
const LIFT = 3.3
/** Hide tags beyond this distance — dots on the minimap already say who's where. */
const MAX_DISTANCE = 360
const FADE_START = 240
const FADE_END = 340
/** Draw distance above the camera far plane minus fog is irrelevant; tags live close. */
const MAX_RENDER_DIST = 400

const HP_W = 120
const HP_H = 10
const HP_Y = 64

function makeTexture(name: string, accent: string, hp: number, maxHp: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H
  const ctx = canvas.getContext('2d')!

  ctx.font = '700 30px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  // Shrink long names rather than truncating — a nickname usually still reads.
  let label = name
  while (ctx.measureText(label).width > CANVAS_W - 32 && label.length > 1) {
    label = label.slice(0, -1)
  }

  const width = Math.max(56, ctx.measureText(label).width + 28)
  const height = 44
  const x = (CANVAS_W - width) / 2
  const y = 8

  // Pill with a tinted border matching the driver's paint.
  ctx.fillStyle = 'rgba(12, 16, 26, 0.72)'
  ctx.strokeStyle = accent
  ctx.lineWidth = 3
  const r = height / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = '#f4f7ff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, CANVAS_W / 2, y + height / 2 + 1)

  // Health bar: dark well, colour-filled remainder. Green > amber > red.
  const hpW = (CANVAS_W - HP_W) / 2
  ctx.fillStyle = 'rgba(12, 16, 26, 0.72)'
  ctx.fillRect(hpW - 2, HP_Y - 2, HP_W + 4, HP_H + 4)
  const ratio = Math.max(0, Math.min(1, hp / maxHp))
  ctx.fillStyle = ratio > 0.55 ? '#58b368' : ratio > 0.25 ? '#f5a623' : '#e8453c'
  ctx.fillRect(hpW, HP_Y, Math.max(ratio > 0 ? 4 : 0, HP_W * ratio), HP_H)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface Tag {
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  distance: number
  name: string
  hp: number
}

export class NameTags {
  readonly group = new THREE.Group()
  private readonly tags = new Map<string, Tag>()

  /**
   * Diffs the roster: new drivers get a tag, gone drivers lose theirs. The
   * canvas redraws only when the name or hp actually changed.
   */
  sync(roster: Iterable<{ id: string; name: string; color: number; hp?: number }>) {
    const seen = new Set<string>()
    for (const player of roster) {
      if (!player.name) continue
      seen.add(player.id)
      const hp = typeof player.hp === 'number' && Number.isFinite(player.hp) ? player.hp : 100
      const existing = this.tags.get(player.id)
      if (existing) {
        if (existing.hp !== hp) {
          existing.hp = hp
          redraw(existing, player.color)
        }
        continue
      }
      const hex = `#${(player.color % 8 === 0 ? 0xf0f0f0 : PALETTE_FALLBACK(player.color)).toString(16).padStart(6, '0')}`
      const material = new THREE.SpriteMaterial({
        map: makeTexture(player.name, hex, hp, 100),
        transparent: true,
        depthTest: false,
        depthWrite: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.center.set(0.5, 0)
      sprite.renderOrder = 20
      this.group.add(sprite)
      this.tags.set(player.id, { sprite, material, distance: 0, name: player.name, hp })
    }
    for (const [id, tag] of this.tags) {
      if (seen.has(id)) continue
      this.group.remove(tag.sprite)
      tag.material.map?.dispose()
      tag.material.dispose()
      this.tags.delete(id)
    }
  }

  /** Called every frame with each visible remote's pose. */
  place(id: string, x: number, y: number, z: number, camera: THREE.Camera) {
    const tag = this.tags.get(id)
    if (!tag) return
    tag.sprite.position.set(x, y + LIFT, z)
    const dx = x - camera.position.x
    const dy = y - camera.position.y
    const dz = z - camera.position.z
    tag.distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (tag.distance > MAX_DISTANCE) {
      tag.sprite.visible = false
      return
    }
    tag.sprite.visible = true
    // Constant screen size: scale with distance so a tag reads the same far away.
    const scale = (tag.distance / 26) * TAG_HEIGHT + TAG_HEIGHT * 0.55
    tag.sprite.scale.set(scale * (CANVAS_W / CANVAS_H), scale, 1)
    const fade =
      tag.distance <= FADE_START ? 1 : Math.max(0, 1 - (tag.distance - FADE_START) / (FADE_END - FADE_START))
    tag.material.opacity = fade
  }

  drop(id: string) {
    const tag = this.tags.get(id)
    if (!tag) return
    this.group.remove(tag.sprite)
    tag.material.map?.dispose()
    tag.material.dispose()
    this.tags.delete(id)
  }

  dispose() {
    for (const [id] of this.tags) this.drop(id)
  }
}

/** Redraw an existing tag's canvas in place after an hp change. */
function redraw(tag: Tag, color: number) {
  const hex = `#${(color % 8 === 0 ? 0xf0f0f0 : PALETTE_FALLBACK(color)).toString(16).padStart(6, '0')}`
  tag.material.map?.dispose()
  tag.material.map = makeTexture(tag.name, hex, tag.hp, 100)
  tag.material.needsUpdate = true
}

/** Stand-in for PALETTE without importing three-dependent city code here. */
function PALETTE_FALLBACK(index: number): number {
  const palette = [0xe8453c, 0xf5a623, 0x3d7dd6, 0x58b368, 0xf0f0f0, 0x2f3b4a, 0xb05ec4, 0x20b8c4]
  return palette[index % palette.length]
}

export type { Tag }
export { MAX_RENDER_DIST }
