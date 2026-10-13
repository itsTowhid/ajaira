import * as THREE from 'three'
import { TILE, generateTile, type Ramp, type Tile } from './tiles'
import type { BoxCollider, CircleCollider } from '../city/layout'

export class CountryWorld {
  readonly group = new THREE.Group()
  private tiles = new Map<string, Tile>()

  ensure(px: number, pz: number): void {
    const cx = Math.floor((px + TILE / 2) / TILE)
    const cz = Math.floor((pz + TILE / 2) / TILE)
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const key = `${cx + dx},${cz + dz}`
        if (this.tiles.has(key)) continue
        const tile = generateTile(cx + dx, cz + dz)
        this.tiles.set(key, tile)
        this.group.add(tile.group)
      }
    }
    for (const [key, tile] of this.tiles) {
      const [sx, sz] = key.split(',').map(Number)
      if (Math.max(Math.abs(sx - cx), Math.abs(sz - cz)) > 3) {
        this.group.remove(tile.group)
        tile.group.traverse((obj) => {
          const mesh = obj as THREE.Mesh
          if (mesh.isMesh) {
            mesh.geometry.dispose()
          }
        })
        this.tiles.delete(key)
      }
    }
  }

  get boxes(): BoxCollider[] {
    const out: BoxCollider[] = []
    for (const tile of this.tiles.values()) out.push(...tile.boxes)
    return out
  }

  get circles(): CircleCollider[] {
    const out: CircleCollider[] = []
    for (const tile of this.tiles.values()) out.push(...tile.circles)
    return out
  }

  get ramps(): Ramp[] {
    const out: Ramp[] = []
    for (const tile of this.tiles.values()) out.push(...tile.ramps)
    return out
  }

  update(dt: number): void {
    for (const tile of this.tiles.values()) {
      for (const spinner of tile.spinners) {
        spinner.rotation.z += 0.6 * dt
      }
    }
  }
}
