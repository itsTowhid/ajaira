import * as THREE from 'three'
import { TILE, GRASS_GEO, generateTile, type Ramp, type Tile } from './tiles'
import { heightAt as terrainHeightAt } from './terrain'
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
          // Grass uses a module-level shared geometry/material: dispose only
          // the per-tile instance buffers, never the shared resources.
          if ((obj as THREE.InstancedMesh).isInstancedMesh) {
            ;(obj as THREE.InstancedMesh).dispose()
            return
          }
          const mesh = obj as THREE.Mesh
          if (mesh.isMesh) {
            if (mesh.geometry !== (GRASS_GEO as THREE.BufferGeometry)) {
              mesh.geometry.dispose()
            }
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

  /** Rideable terrain height at a world point (roads flatten, fields roll). */
  heightAt(x: number, z: number): number {
    return terrainHeightAt(x, z)
  }

  /**
   * Removes the world and frees per-tile geometries. Shared module-level
   * resources (GRASS_GEO, tile materials) are never disposed — only the
   * per-tile instance buffers and owned geometries, deduped like a vehicle.
   */
  dispose(): void {
    this.group.removeFromParent()
    const geometries = new Set<THREE.BufferGeometry>()
    for (const tile of this.tiles.values()) {
      tile.group.traverse((obj) => {
        if ((obj as THREE.InstancedMesh).isInstancedMesh) {
          ;(obj as THREE.InstancedMesh).dispose()
          return
        }
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh && mesh.geometry !== (GRASS_GEO as THREE.BufferGeometry)) {
          geometries.add(mesh.geometry as THREE.BufferGeometry)
        }
      })
    }
    for (const geometry of geometries) geometry.dispose()
    this.tiles.clear()
  }

  update(dt: number): void {
    for (const tile of this.tiles.values()) {
      for (const spinner of tile.spinners) {
        spinner.rotation.z += 0.6 * dt
      }
    }
  }
}
