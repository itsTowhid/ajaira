import { PALETTE } from './city/materials'
import { readProfile, writeProfile, type PlayerProfile } from './net/Presence'
import type { VehicleKind } from './net/protocol'

/**
 * The starting screen. Collects a name, a ride and a paint job, saves them to
 * sessionStorage, and only then hands them to the game — `main` boots after
 * `mountGarage` resolves, so identity is settled before the first network
 * packet. Skipping (Escape, or an empty name) is always allowed: you spawn as
 * an anonymous driver with the classic random colour.
 */

const NAME_MAX = 16
const STORAGE_KEY = 'play-city:profile'

interface GarageResult {
  name: string
  kind: VehicleKind
  colorIndex: number
  /** False when the player skipped; the saved profile is left untouched then. */
  completed: boolean
}

/** The garage owns this shape, so it owns the storage key too. */
function load(): PlayerProfile & { colorIndex: number } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { name: '', kind: 'car', colorIndex: -1 }
    const parsed = JSON.parse(raw) as Partial<PlayerProfile>
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, NAME_MAX) : '',
      kind: parsed.kind === 'bike' ? 'bike' : 'car',
      colorIndex:
        typeof parsed.colorIndex === 'number' && Number.isInteger(parsed.colorIndex)
          ? Math.max(-1, Math.min(PALETTE.cars.length - 1, parsed.colorIndex))
          : -1,
    }
  } catch {
    return { name: '', kind: 'car', colorIndex: -1 }
  }
}

function save(profile: PlayerProfile) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    /* private mode: the game still runs, you just re-answer after a reload */
  }
}

export function mountGarage(): Promise<GarageResult> {
  const root = document.querySelector<HTMLDivElement>('#garage')!
  const nameInput = document.querySelector<HTMLInputElement>('#garage-name')!
  const kindRow = document.querySelector<HTMLDivElement>('#garage-kind')!
  const colorRow = document.querySelector<HTMLDivElement>('#garage-color')!
  const startButton = document.querySelector<HTMLButtonElement>('#garage-start')!

  const saved = load()
  let kind: VehicleKind = saved.kind
  let colorIndex: number = saved.colorIndex

  // One swatch per palette car colour, plus "surprise me" (-1 → random hash).
  const paintless = document.createElement('button')
  paintless.type = 'button'
  paintless.className = 'garage__swatch garage__swatch--any'
  paintless.textContent = '?'
  paintless.title = 'Random colour'
  paintless.dataset.index = String(-1)
  colorRow.appendChild(paintless)
  PALETTE.cars.forEach((hex, index) => {
    const swatch = document.createElement('button')
    swatch.type = 'button'
    swatch.className = 'garage__swatch'
    swatch.style.background = `#${hex.toString(16).padStart(6, '0')}`
    swatch.title = `Colour ${index + 1}`
    swatch.dataset.index = String(index)
    colorRow.appendChild(swatch)
  })

  const paintSelection = () => {
    for (const button of colorRow.querySelectorAll<HTMLButtonElement>('.garage__swatch')) {
      button.classList.toggle('garage__choice--active', Number(button.dataset.index) === colorIndex)
    }
  }
  const paintKind = () => {
    for (const button of kindRow.querySelectorAll<HTMLButtonElement>('.garage__choice')) {
      button.classList.toggle('garage__choice--active', button.dataset.kind === kind)
    }
  }

  nameInput.value = saved.name
  paintKind()
  paintSelection()
  window.setTimeout(() => nameInput.focus(), 50)

  const finish = (completed: boolean) => {
    const name = completed ? nameInput.value.trim().slice(0, NAME_MAX) : saved.name
    const result: GarageResult = { name, kind, colorIndex, completed }
    if (completed) save({ name, kind, colorIndex })
    root.classList.add('garage--hidden')
    window.setTimeout(() => root.remove(), 450)
    resolve(result)
  }

  let resolve!: (result: GarageResult) => void
  const ready = new Promise<GarageResult>((res) => {
    resolve = res
  })

  nameInput.addEventListener('keydown', (event) => {
    // Enter drives; Escape skips the garage entirely.
    if (event.key === 'Enter') finish(true)
    if (event.key === 'Escape') finish(false)
    event.stopPropagation()
  })
  for (const button of kindRow.querySelectorAll<HTMLButtonElement>('.garage__choice')) {
    button.addEventListener('click', () => {
      kind = button.dataset.kind === 'bike' ? 'bike' : 'car'
      paintKind()
    })
  }
  for (const button of colorRow.querySelectorAll<HTMLButtonElement>('.garage__swatch')) {
    button.addEventListener('click', () => {
      colorIndex = Number(button.dataset.index)
      paintSelection()
    })
  }
  startButton.addEventListener('click', () => finish(true))

  return ready
}

// The helpers re-exported here keep `main` from importing storage details twice.
export { readProfile, writeProfile }
