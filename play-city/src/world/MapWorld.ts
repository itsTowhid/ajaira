import * as THREE from 'three'
import { mulberry32 } from '../rng'
import type { BoxCollider, CircleCollider } from '../city/layout'
import type { Ramp } from './tiles'

/**
 * A world built from OpenStreetMap data (via `/api/map/place`), projected
 * equirectangular around the data centroid so north is -Z, matching the
 * three.js top-view conventions used elsewhere. Roads are flat dark ribbons
 * (one box per segment — simple and fine at toy scale), buildings are
 * extruded closed ways, and trees are two instanced meshes.
 */

/** Trimmed wire shape from the relay: only what the world needs. */
export interface MapElement {
  type: 'node' | 'way' | 'relation'
  id: number
  nodes?: number[]
  lat?: number
  lon?: number
  geometry?: Array<{ lat: number; lon: number }>
  tags?: { highway?: string; building?: string; name?: string; height?: string; natural?: string }
}

/** Pull the `elements` array out of a `/api/map/place` payload. */
export function parsePlaceResponse(json: unknown): MapElement[] {
  if (!json || typeof json !== 'object') return []
  const elements = (json as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []
  return elements.filter(
    (el): el is MapElement =>
      !!el && typeof el === 'object' && ((el as MapElement).type === 'node' || (el as MapElement).type === 'way'),
  )
}

const ROAD_CLASSES = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'living_street',
  'service',
  'pedestrian',
  'footway',
  'cycleway',
  'track',
])

/** Rendered roads only; motorway/trunk/footway/cycleway/service/track/pedestrian stay in data but are not drawn. */
const DRAWN_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'])

function roadWidth(highway: string): number {
  if (highway === 'primary') return 9
  if (highway === 'secondary') return 8
  if (highway === 'tertiary') return 7
  if (highway === 'residential') return 6.5
  return 5.5
}

function buildingHeight(tags: MapElement['tags']): number {
  const raw = tags?.height ? Number.parseFloat(tags.height) : Number.NaN
  if (Number.isFinite(raw)) return Math.max(3, Math.min(40, raw))
  const kind = tags?.building ?? ''
  if (kind === 'house') return 4
  if (kind === 'retail' || kind === 'commercial') return 9
  return 6
}

interface Point {
  x: number
  z: number
}

function shoelaceArea(ring: Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i].x * ring[i + 1].z - ring[i + 1].x * ring[i].z
  return sum / 2
}

const MAX_ROAD_SEGMENTS = 4000
const MAX_BUILDINGS = 2500
const MAX_RING_NODES = 3000
const MAX_BUILDING_AREA = 9000
const MAX_EXTRA_TREES = 220

export class MapWorld {
  readonly group = new THREE.Group()
  private readonly boxList: BoxCollider[] = []
  private readonly circleList: CircleCollider[] = []
  private readonly ownMaterials: THREE.Material[] = []

  constructor(elements: MapElement[] = []) {
    // Collect ways with geometry; classify road vs building.
    interface Way {
      pts: Array<{ lat: number; lon: number }>
      highway?: string
      building?: string
      height?: string
    }
    const roadWays: Way[] = []
    const buildingWays: Way[] = []
    const treeNodes: Array<{ lat: number; lon: number }> = []
    const allPts: Array<{ lat: number; lon: number }> = []
    for (const el of elements) {
      if (el.type === 'node') {
        if ((el.tags as Record<string, string> | undefined)?.natural === 'tree' && typeof el.lat === 'number' && typeof el.lon === 'number') {
          treeNodes.push({ lat: el.lat, lon: el.lon })
        }
        continue
      }
      if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue
      const pts = el.geometry.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      if (pts.length < 2) continue
      for (const p of pts) allPts.push(p)
      const highway = el.tags?.highway
      const building = el.tags?.building
      if (typeof highway === 'string' && ROAD_CLASSES.has(highway)) {
        roadWays.push({ pts, highway })
      }
      if (typeof building === 'string' && building !== '' && building !== 'no') {
        buildingWays.push({ pts, building, height: el.tags?.height })
      }
    }

    // Projection: equirectangular around the centroid of all way nodes.
    let lat0 = 0
    let lon0 = 0
    if (allPts.length > 0) {
      let sLat = 0
      let sLon = 0
      for (const p of allPts) {
        sLat += p.lat
        sLon += p.lon
      }
      lat0 = sLat / allPts.length
      lon0 = sLon / allPts.length
    }
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
    const kz = 110540
    const project = (lat: number, lon: number): Point => ({
      x: Math.round((lon - lon0) * kx),
      z: Math.round(-(lat - lat0) * kz),
    })

    const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x3a3f46 })
    const buildingMaterial = new THREE.MeshLambertMaterial({ color: 0xb9b2a6 })
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x86c26b })
    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x6b4a2f })
    const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x4c7a3c })
    this.ownMaterials.push(roadMaterial, buildingMaterial, groundMaterial, trunkMaterial, leafMaterial)

    // Roads: longest ways first, cap total segments. Each segment is a flat
    // box ribbon at y = 0.05; simple and handles self-intersections fine.
    interface Segment {
      x1: number
      z1: number
      x2: number
      z2: number
      width: number
    }
    const waysWithLength = roadWays
      .filter((w) => DRAWN_ROADS.has(w.highway ?? ''))
      .map((w) => {
        const ring = w.pts.map((p) => project(p.lat, p.lon))
        let length = 0
        for (let i = 0; i < ring.length - 1; i++) length += Math.hypot(ring[i + 1].x - ring[i].x, ring[i + 1].z - ring[i].z)
        return { w, ring, length }
      })
      .sort((a, b) => b.length - a.length)
    const segments: Segment[] = []
    for (const { w, ring } of waysWithLength) {
      for (let i = 0; i < ring.length - 1; i++) {
        if (segments.length >= MAX_ROAD_SEGMENTS) break
        const a = ring[i]
        const b = ring[i + 1]
        const len = Math.hypot(b.x - a.x, b.z - a.z)
        if (len < 0.5) continue
        segments.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, width: roadWidth(w.highway ?? '') })
      }
      if (segments.length >= MAX_ROAD_SEGMENTS) break
    }
    for (const s of segments) {
      const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, s.width), roadMaterial)
      mesh.position.set((s.x1 + s.x2) / 2, 0.05, (s.z1 + s.z2) / 2)
      mesh.rotation.y = -Math.atan2(s.z2 - s.z1, s.x2 - s.x1)
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
    const roadMidpoints = segments.map((s) => ({ x: (s.x1 + s.x2) / 2, z: (s.z1 + s.z2) / 2 }))

    // Buildings: closed rings only, extruded to height. Shape y maps to -z
    // via a -PI/2 X rotation; reverse node order when the signed area is
    // negative so the winding (and normals) come out front-facing.
    interface Building {
      ring: Point[]
      area: number
      height: number
    }
    const buildings: Building[] = []
    for (const w of buildingWays) {
      if (w.pts.length > MAX_RING_NODES) continue
      const first = w.pts[0]
      const last = w.pts[w.pts.length - 1]
      if (first.lat !== last.lat || first.lon !== last.lon) continue
      let ring = w.pts.map((p) => project(p.lat, p.lon))
      let area = shoelaceArea(ring)
      if (!Number.isFinite(area) || Math.abs(area) > MAX_BUILDING_AREA) continue
      if (area < 0) {
        ring = [...ring].reverse()
        area = -area
      }
      buildings.push({ ring, area, height: buildingHeight({ building: w.building, height: w.height }) })
    }
    buildings.sort((a, b) => b.area - a.area)
    const kept = buildings.slice(0, MAX_BUILDINGS)
    for (const b of kept) {
      const shape = new THREE.Shape()
      shape.moveTo(b.ring[0].x, b.ring[0].z)
      for (let i = 1; i < b.ring.length; i++) shape.lineTo(b.ring[i].x, b.ring[i].z)
      const geo = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false })
      const mesh = new THREE.Mesh(geo, buildingMaterial)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.y = 0
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.group.add(mesh)
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const p of b.ring) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
      }
      this.boxList.push({
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        hw: Math.max(0.5, (maxX - minX) / 2),
        hd: Math.max(0.5, (maxZ - minZ) / 2),
      })
    }
    const buildingBoxes = this.boxList

    // Trees: OSM nodes, plus deterministic extras when sparse. Extras are
    // rejection-sampled away from road midpoints and building bboxes.
    const treePts = treeNodes.map((t) => project(t.lat, t.lon))
    if (treePts.length < 60) {
      const rng = mulberry32(elements.length)
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const p of allPts.map((q) => project(q.lat, q.lon))) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
      }
      if (!Number.isFinite(minX)) {
        minX = -200
        maxX = 200
        minZ = -200
        maxZ = 200
      }
      const spanX = Math.max(40, maxX - minX)
      const spanZ = Math.max(40, maxZ - minZ)
      let extras = 0
      for (let attempt = 0; attempt < 4000 && extras < MAX_EXTRA_TREES; attempt++) {
        const x = Math.round(minX + rng() * spanX)
        const z = Math.round(minZ + rng() * spanZ)
        let nearRoad = false
        for (const m of roadMidpoints) {
          if (Math.hypot(m.x - x, m.z - z) < 7) {
            nearRoad = true
            break
          }
        }
        if (nearRoad) continue
        let inside = false
        for (const box of buildingBoxes) {
          if (Math.abs(x - box.x) <= box.hw + 3 && Math.abs(z - box.z) <= box.hd + 3) {
            inside = true
            break
          }
        }
        if (inside) continue
        treePts.push({ x, z })
        extras++
      }
    }

    if (treePts.length > 0) {
      const trunkGeo = new THREE.CylinderGeometry(0.25, 0.25, 1.6, 6)
      const leafGeo = new THREE.ConeGeometry(1.6, 3.2, 7)
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMaterial, treePts.length)
      const leaves = new THREE.InstancedMesh(leafGeo, leafMaterial, treePts.length)
      const dummy = new THREE.Object3D()
      treePts.forEach((p, i) => {
        dummy.position.set(p.x, 0.8, p.z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        trunks.setMatrixAt(i, dummy.matrix)
        dummy.position.set(p.x, 1.6 + 1.6, p.z)
        dummy.updateMatrix()
        leaves.setMatrixAt(i, dummy.matrix)
        this.circleList.push({ x: p.x, z: p.z, r: 0.7 })
      })
      trunks.instanceMatrix.needsUpdate = true
      leaves.instanceMatrix.needsUpdate = true
      trunks.castShadow = true
      leaves.castShadow = true
      this.group.add(trunks, leaves)
    }

    // Ground: big circle under everything, sized to the data extent + margin.
    let extent = 300
    {
      let maxR = 0
      const consider = (p: Point) => {
        maxR = Math.max(maxR, Math.hypot(p.x, p.z))
      }
      for (const s of segments) {
        consider({ x: s.x1, z: s.z1 })
        consider({ x: s.x2, z: s.z2 })
      }
      for (const b of kept) for (const p of b.ring) consider(p)
      for (const p of treePts) consider(p)
      if (maxR > 0) extent = maxR + 120
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(extent, 48), groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = 0
    ground.receiveShadow = true
    this.group.add(ground)
  }

  ensure(_px: number, _pz: number): void {
    // Single static chunk: nothing streams in.
  }

  update(_dt: number): void {
    // No animated bits in map mode.
  }

  heightAt(_x: number, _z: number): number {
    return 0
  }

  get boxes(): BoxCollider[] {
    return this.boxList
  }

  get circles(): CircleCollider[] {
    return this.circleList
  }

  get ramps(): Ramp[] {
    return []
  }

  /**
   * Frees this world's geometries. Own materials are disposed too; shared
   * `mat.*` materials are never used here so nothing shared is touched.
   * Geometries are deduped because road segments share nothing but trees do.
   */
  dispose() {
    this.group.removeFromParent()
    const geometries = new Set<THREE.BufferGeometry>()
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh
      if ((object as THREE.InstancedMesh).isInstancedMesh) {
        const inst = object as THREE.InstancedMesh
        if (inst.geometry) geometries.add(inst.geometry as THREE.BufferGeometry)
        inst.dispose()
        return
      }
      if (mesh.isMesh && mesh.geometry) geometries.add(mesh.geometry as THREE.BufferGeometry)
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of this.ownMaterials) material.dispose()
  }
}
