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
  private readonly vehicleEl = document.querySelector<HTMLSpanElement>('#vehicle')!
  private readonly smashEl = document.querySelector<HTMLSpanElement>('#smashed')!
  private readonly killsEl = document.querySelector<HTMLSpanElement>('#kills')!
  private readonly healthEl = document.querySelector<HTMLDivElement>('#health-bar')!
  private readonly flashEl = document.querySelector<HTMLDivElement>('#damage-flash')!
  private readonly wreckedEl = document.querySelector<HTMLDivElement>('#wrecked')!
  private readonly wreckedByEl = document.querySelector<HTMLParagraphElement>('#wrecked-by')!
  private readonly wreckedCountEl = document.querySelector<HTMLSpanElement>('#wrecked-count')!
  private readonly hintEl = document.querySelector<HTMLDivElement>('#hint')!
  private readonly netEl = document.querySelector<HTMLSpanElement>('#net-value')!
  private readonly netDotEl = document.querySelector<HTMLSpanElement>('.net__dot')!
  private readonly mapCanvas = document.querySelector<HTMLCanvasElement>('#minimap')!
  private readonly ctx: CanvasRenderingContext2D

  private hintVisible = true
  private netStatus: NetStatus = 'connecting'
  private netCount = -1
  private healthShown = -1
  private killsShown = -1
  private flashLeft = 0
  private wreckCountdown: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.ctx = this.mapCanvas.getContext('2d')!
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
    if (this.flashLeft > 0) {
      this.flashLeft -= 1 / 60
      if (this.flashLeft <= 0) this.flashEl.style.opacity = '0'
    }
    this.drawMap(position, heading, remotes)
  }

  /** Which ride we're on. Separate from `update` so it only touches the DOM on a swap. */
  setVehicle(label: string) {
    if (this.vehicleEl.textContent === label) return
    this.vehicleEl.textContent = label
  }

  /** Health bar + colour steps; only touches the DOM when the number moves. */
  setHealth(hp: number, maxHp: number) {
    const ratio = Math.max(0, Math.min(1, hp / maxHp))
    const percent = Math.round(ratio * 100)
    if (percent === this.healthShown) return
    this.healthShown = percent
    this.healthEl.style.width = `${percent}%`
    this.healthEl.style.background = ratio > 0.55 ? '#58b368' : ratio > 0.25 ? '#f5a623' : '#e8453c'
  }

  /** Red flash on taking a hit. */
  damageFlash() {
    this.flashLeft = 0.4
    this.flashEl.style.opacity = '0.55'
  }

  setKills(kills: number) {
    if (kills === this.killsShown) return
    this.killsShown = kills
    this.killsEl.textContent = String(kills)
  }

  /** Wrecked overlay with a live countdown; `name` is who did it (when known). */
  showWrecked(name: string) {
    this.wreckedByEl.textContent = name ? `taken out by ${name}` : 'someone took you out'
    this.wreckedEl.classList.remove('wrecked--hidden')
    let seconds = 3
    this.wreckedCountEl.textContent = String(seconds)
    this.wreckCountdown = setInterval(() => {
      seconds -= 1
      this.wreckedCountEl.textContent = String(Math.max(0, seconds))
      if (seconds <= 0 && this.wreckCountdown) {
        clearInterval(this.wreckCountdown)
        this.wreckCountdown = null
      }
    }, 1000)
  }

  hideWrecked() {
    if (this.wreckCountdown) {
      clearInterval(this.wreckCountdown)
      this.wreckCountdown = null
    }
    this.wreckedEl.classList.add('wrecked--hidden')
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
    this.ctx.clearRect(0, 0, size, size)

    this.ctx.fillStyle = '#33412e'
    this.ctx.fillRect(0, 0, size, size)

    this.mapBase = this.ctx.getImageData(0, 0, size, size)
  }

  private mapBase!: ImageData

  private drawMap(position: { x: number; z: number }, heading: number, remotes: readonly RemoteBlip[]) {
    const size = this.mapCanvas.width
    this.ctx.putImageData(this.mapBase, 0, 0)

    const scale = size / 280
    const toX = (x: number) => size / 2 + (x - position.x) * scale
    const toY = (z: number) => size / 2 + (z - position.z) * scale

    // Paint is only unique for the first few players, so the dot is what actually
    // tells two cars apart.
    for (const remote of remotes) {
      const dx = remote.x - position.x
      const dz = remote.z - position.z
      if (Math.hypot(dx, dz) > 140) continue
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
