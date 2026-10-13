/**
 * Rolling-hills height field for the infinite countryside.
 *
 * Everything is a pure function of world (x, z), so neighbouring tiles always
 * agree at seams: meshes, props, physics, and bullets all sample these same
 * functions. No tile-local state, no rng — continuity is structural.
 */

/** Raw hill height: 3 sine octaves, amplitude ~7.1, wavelengths ~70-370. */
export function terrainHeight(x: number, z: number): number {
  return (
    4.2 * Math.sin(x * 0.021 + 1.7) * Math.cos(z * 0.017 + 0.6) +
    2.1 * Math.sin(x * 0.043 + z * 0.031 + 2.1) +
    0.8 * Math.sin(x * 0.089 - z * 0.077 + 4.0)
  )
}

/**
 * Curvy-road wander: how far the centreline of a road drifts off its tile
 * line. `axis 'x'` is a vertical road pinned at world line X0, wandering as a
 * function of z (and symmetric for horizontal roads). Shared by tiles.ts
 * (mesh painting, prop avoidance) and anything else that needs the centreline.
 */
export function roadOffset(axis: 'x' | 'z', line: number, along: number): number {
  return axis === 'x'
    ? 14 * Math.sin(along * 0.019 + line * 0.7)
    : 14 * Math.sin(along * 0.017 + line * 0.9)
}

/** Road tile lines repeat every 3 tiles (see tiles.ts mod3 logic). */
export const ROAD_LINE_SPACING = 288

const nearestRoadLine = (v: number): number =>
  Math.round(v / ROAD_LINE_SPACING) * ROAD_LINE_SPACING

/**
 * Shortest world-space distance from (x, z) to any road centreline,
 * accounting for the wander. Used for both height flattening and painting,
 * so the two can never disagree (and tiles agree with each other).
 */
export function distanceToRoadCentre(x: number, z: number): number {
  const x0 = nearestRoadLine(x)
  const z0 = nearestRoadLine(z)
  const dx = Math.abs(x - (x0 + roadOffset('x', x0, z)))
  const dz = Math.abs(z - (z0 + roadOffset('z', z0, x)))
  return Math.min(dx, dz)
}

/** Half road width (matches tiles.ts ROAD_W / 2). */
export const ROAD_HALF = 6
/** Proximity reaches 0 this far past the road edge. */
export const ROAD_BLEND = 12

/** 1 on the centreline, smoothstep falloff to 0 at ROAD_HALF + ROAD_BLEND. */
export function proximityFromDistance(d: number): number {
  const outer = ROAD_HALF + ROAD_BLEND
  if (d <= ROAD_HALF) return 1
  if (d >= outer) return 0
  const t = (d - ROAD_HALF) / (outer - ROAD_HALF)
  return 1 - t * t * (3 - 2 * t)
}

/** Road proximity at a world point (1 on centreline → 0 well off-road). */
export function roadProximityAt(x: number, z: number): number {
  return proximityFromDistance(distanceToRoadCentre(x, z))
}

/**
 * Rideable height: raw hills flattened 55% on road centrelines so roads stay
 * drivable while fields keep their roll. Pass a precomputed proximity when
 * painting a mesh vertex (cheaper in bulk); omit it and it is derived.
 */
export function heightAt(x: number, z: number, roadProximity?: number): number {
  const prox = roadProximity ?? roadProximityAt(x, z)
  return terrainHeight(x, z) * (1 - 0.55 * prox)
}
