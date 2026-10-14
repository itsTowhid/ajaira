import { PALETTE } from './city/materials'
import { readProfile, writeProfile, type PlayerProfile } from './net/Presence'
import type { MapPlace, VehicleKind } from './net/protocol'

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
  /** Chosen OSM place, or null for the regular countryside. */
  mapPlace: MapPlace | null
}

function isMapPlace(value: unknown): value is MapPlace {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  if (typeof p.id !== 'string' || !/^[NWR]\d+$/.test(p.id)) return false
  if (typeof p.name !== 'string' || typeof p.lat !== 'number' || typeof p.lon !== 'number') return false
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false
  const bbox = p.bbox as Record<string, unknown> | undefined
  if (!bbox || typeof bbox !== 'object') return false
  const { s, w, n, e } = bbox
  if (![s, w, n, e].every((v) => typeof v === 'number' && Number.isFinite(v))) return false
  if (!((s as number) < (n as number) && (w as number) < (e as number))) return false
  return true
}

/** The garage owns this shape, so it owns the storage key too. */
function load(): PlayerProfile & { colorIndex: number; mapPlace: MapPlace | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { name: '', kind: 'car', colorIndex: -1, mapPlace: null }
    const parsed = JSON.parse(raw) as Partial<PlayerProfile> & { map?: unknown }
    return {
      name: typeof parsed.name === 'string' ? parsed.name.slice(0, NAME_MAX) : '',
      kind: parsed.kind === 'bike' ? 'bike' : parsed.kind === 'plane' ? 'plane' : 'car',
      colorIndex:
        typeof parsed.colorIndex === 'number' && Number.isInteger(parsed.colorIndex)
          ? Math.max(-1, Math.min(PALETTE.cars.length - 1, parsed.colorIndex))
          : -1,
      mapPlace: isMapPlace(parsed.map) ? parsed.map : null,
    }
  } catch {
    return { name: '', kind: 'car', colorIndex: -1, mapPlace: null }
  }
}

function save(profile: PlayerProfile & { mapPlace?: MapPlace | null }) {
  try {
    const payload: PlayerProfile & { map?: MapPlace | null } = {
      name: profile.name,
      kind: profile.kind,
      colorIndex: profile.colorIndex,
    }
    if (profile.mapPlace) payload.map = profile.mapPlace
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
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
  let mapPlace: MapPlace | null = saved.mapPlace

  const mapInput = document.querySelector<HTMLInputElement>('#garage-map')
  const mapSearch = document.querySelector<HTMLButtonElement>('#garage-map-search')
  const mapResults = document.querySelector<HTMLDivElement>('#garage-map-results')

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
      // Swatches need their own active class — `garage__choice--active` would
      // set text/border colours that the later `.garage__swatch` rule overrides.
      button.classList.toggle('garage__swatch--active', Number(button.dataset.index) === colorIndex)
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
    const result: GarageResult = { name, kind, colorIndex, completed, mapPlace: completed ? mapPlace : saved.mapPlace }
    if (completed) save({ name, kind, colorIndex, mapPlace })
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
      kind =
        button.dataset.kind === 'bike' ? 'bike' : button.dataset.kind === 'plane' ? 'plane' : 'car'
      paintKind()
    })
  }
  for (const button of colorRow.querySelectorAll<HTMLButtonElement>('.garage__swatch')) {
    button.addEventListener('click', () => {
      colorIndex = Number(button.dataset.index)
      paintSelection()
    })
  }
  // Map search (optional): empty search + Drive keeps today's country mode.
  // Picking a result stores it; "× clear" resets to null.
  const shortName = (name: string): string => name.split(',').slice(0, 3).join(',').trim()
  const paintMapResults = (results: MapPlace[]) => {
    if (!mapResults) return
    mapResults.textContent = ''
    if (mapPlace) {
      const picked = document.createElement('div')
      picked.className = 'garage__map-picked'
      picked.textContent = shortName(mapPlace.name)
      const clear = document.createElement('button')
      clear.type = 'button'
      clear.className = 'garage__map-clear'
      clear.textContent = '× clear'
      clear.addEventListener('click', (event) => {
        event.stopPropagation()
        mapPlace = null
        paintMapResults(results)
      })
      picked.appendChild(clear)
      mapResults.appendChild(picked)
    }
    for (const place of results.slice(0, 5)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'garage__mapresult'
      if (mapPlace?.id === place.id) button.classList.add('garage__mapresult--active')
      button.textContent = shortName(place.name)
      button.title = place.name
      button.addEventListener('click', () => {
        mapPlace = place
        paintMapResults(results)
      })
      mapResults.appendChild(button)
    }
  }
  let lastResults: MapPlace[] = []
  const runMapSearch = async () => {
    if (!mapInput || !mapSearch || !mapResults) return
    const q = mapInput.value.trim()
    if (q.length < 3) return
    mapSearch.disabled = true
    try {
      const res = await fetch(`/api/map/geocode?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error(`geocode ${res.status}`)
      const json = (await res.json()) as { results?: MapPlace[] }
      lastResults = Array.isArray(json.results) ? json.results.slice(0, 5) : []
      paintMapResults(lastResults)
      if (lastResults.length === 0) mapResults.textContent = 'no places found'
    } catch {
      mapResults.textContent = 'search failed'
    } finally {
      mapSearch.disabled = false
    }
  }
  if (mapPlace && mapResults) paintMapResults([])
  mapSearch?.addEventListener('click', () => void runMapSearch())
  mapInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void runMapSearch()
    event.stopPropagation()
  })
  startButton.addEventListener('click', () => finish(true))

  return ready
}

// The helpers re-exported here keep `main` from importing storage details twice.
export { readProfile, writeProfile }
