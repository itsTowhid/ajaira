export interface InputState {
  throttle: number
  steer: number
  brake: boolean
  dragX: number
  dragY: number
  zoomDelta: number
  toggleCamera: boolean
  toggleHelp: boolean
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
  private dragging = false
  private lastX = 0
  private lastY = 0

  readonly state: InputState = {
    throttle: 0,
    steer: 0,
    brake: false,
    dragX: 0,
    dragY: 0,
    zoomDelta: 0,
    toggleCamera: false,
    toggleHelp: false,
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
    })

    window.addEventListener('keyup', (event) => {
      const action = KEY_MAP[event.code]
      if (action) this.held.delete(action)
    })

    window.addEventListener('blur', () => this.held.clear())

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
    const forward = this.held.has('forward')
    const back = this.held.has('back')
    this.state.throttle = (forward ? 1 : 0) + (back ? -1 : 0)
    this.state.steer = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0)
    this.state.brake = this.held.has('brake')
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
}
