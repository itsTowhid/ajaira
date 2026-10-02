import * as THREE from 'three'

export const BEVEL = 0.032

function sectorShape(
  rInner: number,
  rOuter: number,
  start: number,
  end: number,
): THREE.Shape {
  const shape = new THREE.Shape()
  if (rInner <= 0.001) {
    shape.moveTo(0, 0)
    shape.lineTo(Math.cos(start) * rOuter, Math.sin(start) * rOuter)
    shape.absarc(0, 0, rOuter, start, end, false)
    shape.lineTo(0, 0)
  } else {
    shape.absarc(0, 0, rOuter, start, end, false)
    shape.absarc(0, 0, rInner, end, start, true)
    shape.closePath()
  }
  return shape
}

export function buildWedge(
  rInner: number,
  rOuter: number,
  start: number,
  end: number,
  depth: number,
): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(sectorShape(rInner, rOuter, start, end), {
    depth,
    steps: 1,
    curveSegments: 40,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelOffset: 0,
    bevelSegments: 2,
  })
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, depth + BEVEL, 0)
  geometry.computeVertexNormals()
  return geometry
}

export function slabHeight(depth: number): number {
  return depth + BEVEL * 2
}
