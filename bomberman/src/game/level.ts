// Single-level spec. Matches docs/stage.svg: 13x11, wood border,
// stone pillars on even/even interior cells, toy crates with safe spawns.

export const COLS = 13
export const ROWS = 11

export const SPAWN_P1 = { cx: 1, cz: 1 }
export const SPAWN_P2 = { cx: COLS - 2, cz: ROWS - 2 }

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function inSafeZone(cx: number, cz: number): boolean {
  const safe = new Set([
    `1,1`, `2,1`, `1,2`,
    `${COLS - 2},${ROWS - 2}`, `${COLS - 3},${ROWS - 2}`, `${COLS - 2},${ROWS - 3}`,
  ])
  return safe.has(`${cx},${cz}`)
}

export function isPillar(cx: number, cz: number): boolean {
  if (cx === 0 || cz === 0 || cx === COLS - 1 || cz === ROWS - 1) return true
  return cx % 2 === 0 && cz % 2 === 0
}

/** Deterministic crates so both net peers generate identical boards. */
export function generateCrates(seed = 7, fill = 0.65): Set<string> {
  const rand = mulberry32(seed)
  const crates = new Set<string>()
  for (let cz = 1; cz < ROWS - 1; cz++) {
    for (let cx = 1; cx < COLS - 1; cx++) {
      if (isPillar(cx, cz)) continue
      if (inSafeZone(cx, cz)) continue
      if (rand() < fill) crates.add(`${cx},${cz}`)
    }
  }
  return crates
}

/** Grid (col,row) -> world (x,z), centered at origin. Tile size = 1. */
export function cellToWorld(cx: number, cz: number) {
  return { x: cx - (COLS - 1) / 2, z: cz - (ROWS - 1) / 2 }
}

export function worldToCell(x: number, z: number) {
  return {
    cx: Math.round(x + (COLS - 1) / 2),
    cz: Math.round(z + (ROWS - 1) / 2),
  }
}
