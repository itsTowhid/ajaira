export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const rand = (rng: Rng, min: number, max: number) => min + rng() * (max - min)

export const pick = <T>(rng: Rng, list: readonly T[]): T =>
  list[Math.min(list.length - 1, Math.floor(rng() * list.length))]

export const chance = (rng: Rng, probability: number) => rng() < probability
