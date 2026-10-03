export interface InputState {
  throttle: number
  steer: number
  brake: boolean
  dragX: number
  dragY: number
  zoomDelta: number
  toggleCamera: boolean
  toggleHelp: boolean
  toggleVehicle: boolean
}

const KEY_MAP: Record<string, string> = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  ArrowDown: 'back',
  KeyS: 'back',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'brake',
}

export class Input {
  private held = new Set<string>()
  private virtual = new Set<string>()
  private dragging = false
  private lastX = 0
  private lastY = 0

  /** Map of on-screen control element -> action, for touch devices. */
  static readonly VIRTUAL_CONTROLS: ReadonlyArray<readonly [string, string]> = [
    ['ctl-left', 'left'],
    ['ctl-right', 'right'],
    ['ctl-gas', 'forward'],
    ['ctl-back', 'back'],
    ['ctl-brake', 'brake'],
  ]

  readonly state: InputState = {
    throttle: 0,
    steer: 0,
    brake: false,
    dragX: 0,
    dragY: 0,
    zoomDelta: 0,
    toggleCamera: false,
    toggleHelp: false,
    toggleVehicle: false,
  }

  constructor(element: HTMLElement) {
    window.addEventListener('keydown', (event) => {
      const action = KEY_MAP[event.code]
      if (action) {
        this.held.add(action)
        event.preventDefault()
      }
      if (event.code === 'KeyC') this.state.toggleCamera = true
      if (event.code === 'KeyH') this.state.toggleHelp = true
      if (event.code === 'KeyV') this.state.toggleVehicle = true
    })

    window.addEventListener('keyup', (event) => {
      const action = KEY_MAP[event.code]
      if (action) this.held.delete(action)
    })

    window.addEventListener('blur', () => this.held.clear())

    // On-screen driving controls (mobile). Buttons fire pointer events, not
    // key events, and a finger sliding off a button must release it — so they
    // are tracked in their own set, toggled by pointerdown/up/enter/leave.
    for (const [id, action] of Input.VIRTUAL_CONTROLS) {
      const button = document.getElementById(id)
      if (!button) continue
      const press = (event: Event) => {
        event.preventDefault()
        this.virtual.add(action)
      }
      const release = () => this.virtual.delete(action)
      button.addEventListener('pointerdown', press)
      button.addEventListener('pointerup', release)
      button.addEventListener('pointercancel', release)
      button.addEventListener('pointerleave', release)
      button.addEventListener('contextmenu', (event) => event.preventDefault())
    }

    element.addEventListener('pointerdown', (event) => {
      this.dragging = true
      this.lastX = event.clientX
      this.lastY = event.clientY
      element.setPointerCapture(event.pointerId)
    })

    element.addEventListener('pointermove', (event) => {
      if (!this.dragging) return
      this.state.dragX += event.clientX - this.lastX
      this.state.dragY += event.clientY - this.lastY
      this.lastX = event.clientX
      this.lastY = event.clientY
    })

    const stop = () => {
      this.dragging = false
    }
    element.addEventListener('pointerup', stop)
    element.addEventListener('pointercancel', stop)

    element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        this.state.zoomDelta += event.deltaY
      },
      { passive: false },
    )
  }

  poll(): InputState {
    const forward = this.held.has('forward') || this.virtual.has('forward')
    const back = this.held.has('back') || this.virtual.has('back')
    this.state.throttle = (forward ? 1 : 0) + (back ? -1 : 0)
    this.state.steer =
      (this.held.has('right') || this.virtual.has('right') ? 1 : 0) -
      (this.held.has('left') || this.virtual.has('left') ? 1 : 0)
    this.state.brake = this.held.has('brake') || this.virtual.has('brake')
    return this.state
  }

  consumeDrag() {
    const result = { x: this.state.dragX, y: this.state.dragY }
    this.state.dragX = 0
    this.state.dragY = 0
    return result
  }

  consumeZoom() {
    const value = this.state.zoomDelta
    this.state.zoomDelta = 0
    return value
  }

  consumeCameraToggle() {
    const value = this.state.toggleCamera
    this.state.toggleCamera = false
    return value
  }

  consumeHelpToggle() {
    const value = this.state.toggleHelp
    this.state.toggleHelp = false
    return value
  }

  consumeVehicleToggle() {
    const value = this.state.toggleVehicle
    this.state.toggleVehicle = false
    return value
  }
}
