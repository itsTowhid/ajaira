/**
 * Radial speed streaks overlaid on the whole viewport. Fades in above
 * ~110 km/h and gets longer / more opaque the faster you go.
 */
export class Speedlines {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly streaks: { angle: number; offset: number; len: number }[] = []
  private readonly onResize = () => {
    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  constructor(count = 26) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'speedlines'
    document.body.appendChild(this.canvas)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('speedlines: 2d context unavailable')
    this.ctx = ctx
    // Angles are fixed for the session so streaks don't swim between frames.
    for (let i = 0; i < count; i++) {
      this.streaks.push({
        angle: Math.random() * Math.PI * 2,
        offset: Math.random(),
        len: 0.6 + Math.random() * 0.9,
      })
    }
    window.addEventListener('resize', this.onResize)
    this.onResize()
  }

  draw(kmh: number) {
    const w = this.canvas.width
    const h = this.canvas.height
    const k = Math.min(1, Math.max(0, (kmh - 110) / 190))
    if (k <= 0) {
      this.ctx.clearRect(0, 0, w, h)
      return
    }
    const cx = w / 2
    const cy = h / 2
    const base = 0.3 * Math.min(w, h)
    this.ctx.clearRect(0, 0, w, h)
    this.ctx.strokeStyle = `rgba(255,255,255,${0.28 * k})`
    this.ctx.lineWidth = 1.5 + 2 * k
    this.ctx.beginPath()
    for (const s of this.streaks) {
      const r0 = base * (1 + s.offset * 0.15 + Math.random() * 0.15)
      const r1 = r0 + (30 + 130 * k) * s.len
      const cos = Math.cos(s.angle)
      const sin = Math.sin(s.angle)
      this.ctx.moveTo(cx + cos * r0, cy + sin * r0)
      this.ctx.lineTo(cx + cos * r1, cy + sin * r1)
    }
    this.ctx.stroke()
  }

  dispose() {
    window.removeEventListener('resize', this.onResize)
    this.canvas.remove()
  }
}
