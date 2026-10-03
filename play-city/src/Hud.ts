import { BLOCK, CITY_HALF, CITY_SIZE, GRID, ROAD_W, type CityLayout } from './city/layout'
import { PALETTE } from './city/materials'
import type { NetStatus } from './net/protocol'

/** The minimap needs the car's paint as CSS, and pulling in three.js for that is silly. */
function hexColor(index: number): string {
  return `#${PALETTE.cars[index % PALETTE.cars.length].toString(16).padStart(6, '0')}`
}

export interface RemoteBlip {
  x: number
  z: number
  color: number
}

export class Hud {
  private readonly speedEl = document.querySelector<HTMLSpanElement>('#speed')!
  private readonly gearEl = document.querySelector<HTMLSpanElement>('#gear')!
  private readonly smashEl = document.querySelector<HTMLSpanElement>('#smashed')!
  private readonly hintEl = document.querySelector<HTMLDivElement>('#hint')!
  private readonly netEl = document.querySelector<HTMLSpanElement>('#net-value')!
  private readonly netDotEl = document.querySelector<HTMLSpanElement>('.net__dot')!
  private readonly mapCanvas = document.querySelector<HTMLCanvasElement>('#minimap')!
  private readonly ctx: CanvasRenderingContext2D

  private hintVisible = true
  private blocks: { x: number; z: number; kind: string }[] = []
  private netStatus: NetStatus = 'connecting'
  private netCount = -1

  constructor(layout: CityLayout) {
    this.ctx = this.mapCanvas.getContext('2d')!
    for (const lot of layout.lots) {
      this.blocks.push({ x: lot.centerX, z: lot.centerZ, kind: lot.kind })
    }
    this.drawMapBase()
    window.setTimeout(() => {
      if (this.hintVisible) this.toggleHint()
    }, 11000)
  }

  toggleHint() {
    this.hintVisible = !this.hintVisible
    this.hintEl.classList.toggle('hint--hidden', !this.hintVisible)
  }

  update(
    kmh: number,
    gear: string,
    position: { x: number; z: number },
    heading: number,
    smashed: number,
    remotes: readonly RemoteBlip[],
  ) {
    this.speedEl.textContent = String(Math.round(kmh)).padStart(3, '0')
    this.gearEl.textContent = gear
    this.smashEl.textContent = String(smashed)
    this.drawMap(position, heading, remotes)
  }

  /** Multiplayer pill. `count` is everybody else, so "solo" is a count of zero. */
  setNet(status: NetStatus, count: number) {
    if (status === this.netStatus && count === this.netCount) return
    this.netStatus = status
    this.netCount = count
    this.netDotEl.dataset.state = status
    this.netEl.textContent = status === 'connecting' ? 'linking' : count > 0 ? `${count + 1} drivers` : 'solo'
  }

  private drawMapBase() {
    const size = this.mapCanvas.width
    const scale = size / CITY_SIZE
    this.ctx.clearRect(0, 0, size, size)

    this.ctx.fillStyle = '#2b2f38'
    this.ctx.fillRect(0, 0, size, size)

    this.ctx.fillStyle = '#454b57'
    for (let i = 0; i <= GRID; i++) {
      const offset = (-CITY_HALF + ROAD_W / 2 + i * (BLOCK + ROAD_W)) * scale + size / 2
      this.ctx.fillRect(offset - ROAD_W / 2 * scale, 0, ROAD_W * scale, size)
      this.ctx.fillRect(0, offset - ROAD_W / 2 * scale, size, ROAD_W * scale)
    }

    for (const block of this.blocks) {
      this.ctx.fillStyle =
        block.kind === 'parking'
          ? '#5b6270'
          : block.kind === 'park'
            ? '#4c8a4a'
            : block.kind === 'playground'
              ? '#c96a5c'
              : block.kind === 'plaza'
                ? '#7d8ba0'
                : '#8d8f99'
      const w = BLOCK * scale
      this.ctx.fillRect(block.x * scale + size / 2 - w / 2, block.z * scale + size / 2 - w / 2, w, w)
    }

    this.mapBase = this.ctx.getImageData(0, 0, size, size)
  }

  private mapBase!: ImageData

  private drawMap(position: { x: number; z: number }, heading: number, remotes: readonly RemoteBlip[]) {
    const size = this.mapCanvas.width
    const scale = size / CITY_SIZE
    this.ctx.putImageData(this.mapBase, 0, 0)

    const toX = (x: number) => x * scale + size / 2
    const toY = (z: number) => z * scale + size / 2

    // Paint is only unique for the first few players, so the dot is what actually
    // tells two cars apart.
    for (const remote of remotes) {
      this.ctx.fillStyle = hexColor(remote.color)
      this.ctx.beginPath()
      this.ctx.arc(toX(remote.x), toY(remote.z), 3.5, 0, Math.PI * 2)
      this.ctx.fill()
    }

    this.ctx.save()
    this.ctx.translate(toX(position.x), toY(position.z))
    // Map is a top view with +x right and +z down; heading 0 faces +z (down).
    // The arrow is drawn pointing up, so the canvas rotation is π − heading —
    // plain −heading mirrors steering and flips the arrow 180°.
    this.ctx.rotate(Math.PI - heading)
    this.ctx.fillStyle = '#ffd45e'
    this.ctx.beginPath()
    this.ctx.moveTo(0, -7)
    this.ctx.lineTo(5, 6)
    this.ctx.lineTo(0, 3)
    this.ctx.lineTo(-5, 6)
    this.ctx.closePath()
    this.ctx.fill()
    this.ctx.restore()
  }
}
