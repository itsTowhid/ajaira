/**
 * Touch controls for mobile: floating joystick (left) + bomb button (right).
 * Multi-touch safe: joystick and button track separate pointerIds.
 * Screen mapping matches the iso camera: drag up = away (-z), right = +x.
 */
export class TouchControls {
  /** -1..1 movement vector, screen-space (x right, z down). */
  readonly vec = { x: 0, z: 0 }
  readonly isTouch: boolean

  private joyId: number | null = null
  private joyCX = 0
  private joyCY = 0
  private bombQueued = false

  private zone: HTMLElement | null
  private base: HTMLElement | null
  private knob: HTMLElement | null

  static readonly RADIUS = 64
  static readonly DEADZONE = 0.24

  constructor() {
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (this.isTouch) document.body.classList.add('touch')
    this.zone = document.getElementById('joy-zone')
    this.base = document.getElementById('joy-base')
    this.knob = document.getElementById('joy-knob')
    const bomb = document.getElementById('btn-bomb')
    if (!this.zone || !this.base || !this.knob || !bomb) return

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return
      this.joyId = e.pointerId
      this.joyCX = e.clientX
      this.joyCY = e.clientY
      this.base!.style.display = 'block'
      this.base!.style.left = `${e.clientX}px`
      this.base!.style.top = `${e.clientY}px`
      this.setKnob(0, 0)
      this.zone!.setPointerCapture(e.pointerId)
      e.preventDefault()
    })
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return
      let dx = e.clientX - this.joyCX
      let dy = e.clientY - this.joyCY
      const len = Math.hypot(dx, dy)
      if (len > TouchControls.RADIUS) {
        dx = (dx / len) * TouchControls.RADIUS
        dy = (dy / len) * TouchControls.RADIUS
      }
      this.setKnob(dx, dy)
      this.vec.x = dx / TouchControls.RADIUS
      this.vec.z = dy / TouchControls.RADIUS
      e.preventDefault()
    })
    const releaseJoy = (e: PointerEvent) => {
      if (e.pointerId !== this.joyId) return
      this.joyId = null
      this.vec.x = 0
      this.vec.z = 0
      this.base!.style.display = 'none'
    }
    this.zone.addEventListener('pointerup', releaseJoy)
    this.zone.addEventListener('pointercancel', releaseJoy)

    bomb.addEventListener('pointerdown', (e) => {
      this.bombQueued = true
      e.preventDefault()
    })
    bomb.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private setKnob(dx: number, dy: number) {
    if (!this.knob) return
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }

  get active(): boolean {
    return Math.hypot(this.vec.x, this.vec.z) > TouchControls.DEADZONE
  }

  /** True once per queued bomb tap. */
  consumeBomb(): boolean {
    if (!this.bombQueued) return false
    this.bombQueued = false
    return true
  }
}
