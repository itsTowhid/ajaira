import * as THREE from 'three'
import { GRID, LANE, ROAD_LINES, type CircleCollider } from './layout'
import { mat, PALETTE } from './materials'

const CAR_COUNT = 16
const TURN_CHANCE = 0.45
const EDGE = ROAD_LINES[ROAD_LINES.length - 1]
const WHEELS: [number, number][] = [
  [-0.98, 1.3],
  [0.98, 1.3],
  [-0.98, -1.3],
  [0.98, -1.3],
]

interface Agent {
  axis: 'x' | 'z'
  roadIndex: number
  dir: 1 | -1
  junction: number
  t: number
  cruise: number
  speed: number
  colorIndex: number
  knockTime: number
  vx: number
  vz: number
  spin: number
  x: number
  z: number
  heading: number
}

const white = new THREE.MeshLambertMaterial({ color: 0xffffff })
const unitBox = new THREE.BoxGeometry(1, 1, 1)
const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12)
wheelGeometry.rotateZ(Math.PI / 2)

function laneOffset(axis: Agent['axis'], dir: 1 | -1) {
  if (axis === 'z') return { x: dir > 0 ? -LANE : LANE, z: 0 }
  return { x: 0, z: dir > 0 ? LANE : -LANE }
}

function headingFor(axis: Agent['axis'], dir: 1 | -1) {
  if (axis === 'z') return dir > 0 ? 0 : Math.PI
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2
}

export class Traffic {
  readonly group = new THREE.Group()
  readonly colliders: CircleCollider[] = []

  private agents: Agent[] = []
  private bodies: THREE.InstancedMesh
  private cabins: THREE.InstancedMesh
  private glass: THREE.InstancedMesh
  private wheels: THREE.InstancedMesh
  private readonly dummy = new THREE.Object3D()
  private readonly colour = new THREE.Color()

  constructor() {
    this.bodies = new THREE.InstancedMesh(unitBox, white, CAR_COUNT)
    this.cabins = new THREE.InstancedMesh(unitBox, white, CAR_COUNT)
    this.glass = new THREE.InstancedMesh(unitBox, mat.glass(), CAR_COUNT)
    this.wheels = new THREE.InstancedMesh(wheelGeometry, mat.tyre(), CAR_COUNT * 4)
    this.bodies.castShadow = true
    this.cabins.castShadow = true
    for (const mesh of [this.bodies, this.cabins, this.glass, this.wheels]) {
      mesh.frustumCulled = false
      this.group.add(mesh)
    }

    for (let i = 0; i < CAR_COUNT; i++) this.agents.push(this.spawn(i))
    this.colliders = this.agents.map(() => ({ x: 0, z: 0, r: 1.6 }) as CircleCollider)
  }

  private spawn(index: number): Agent {
    const axis: Agent['axis'] = Math.random() < 0.5 ? 'x' : 'z'
    const roadIndex = 1 + Math.floor(Math.random() * (GRID - 1))
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1
    const offset = laneOffset(axis, dir)
    const t = -EDGE + 20 + Math.random() * (EDGE * 2 - 40)
    return {
      axis,
      roadIndex,
      dir,
      junction: roadIndex + dir,
      t,
      cruise: 6 + Math.random() * 4,
      speed: 6 + Math.random() * 4,
      colorIndex: index % PALETTE.cars.length,
      knockTime: 0,
      vx: 0,
      vz: 0,
      spin: 0,
      x: axis === 'z' ? ROAD_LINES[roadIndex] + offset.x : t,
      z: axis === 'z' ? t : ROAD_LINES[roadIndex] + offset.z,
      heading: headingFor(axis, dir),
    }
  }

  knock(index: number, pushX: number, pushZ: number) {
    const agent = this.agents[index]
    if (!agent) return
    agent.knockTime = 2.4
    agent.vx = pushX
    agent.vz = pushZ
    agent.spin = (Math.random() - 0.5) * 7
    agent.speed = 0
  }

  update(dt: number, playerX: number, playerZ: number, playerSpeed: number) {
    const step = Math.min(dt, 0.05)

    for (const agent of this.agents) {
      if (agent.knockTime > 0) {
        agent.knockTime -= step
        agent.x += agent.vx * step
        agent.z += agent.vz * step
        agent.heading += agent.spin * step
        agent.vx -= agent.vx * 2.2 * step
        agent.vz -= agent.vz * 2.2 * step
        agent.spin -= agent.spin * 1.6 * step
        if (agent.knockTime <= 0) this.resnap(agent)
        continue
      }

      const target = this.cruiseTarget(agent, playerX, playerZ, playerSpeed)
      agent.speed += THREE.MathUtils.clamp(target - agent.speed, -9 * step, 4.5 * step)
      agent.t += agent.dir * agent.speed * step
      this.advance(agent)

      const offset = laneOffset(agent.axis, agent.dir)
      if (agent.axis === 'z') {
        agent.x = ROAD_LINES[agent.roadIndex] + offset.x
        agent.z = agent.t
      } else {
        agent.z = ROAD_LINES[agent.roadIndex] + offset.z
        agent.x = agent.t
      }
      agent.heading = headingFor(agent.axis, agent.dir)
    }

    this.writeInstances()
    this.syncColliders()
  }

  private cruiseTarget(agent: Agent, playerX: number, playerZ: number, playerSpeed: number) {
    let target = agent.cruise

    for (const other of this.agents) {
      if (other === agent || other.knockTime > 0) continue
      if (other.axis !== agent.axis || other.roadIndex !== agent.roadIndex) continue
      const ahead = (other.t - agent.t) * agent.dir
      if (ahead > 0 && ahead < 9) target = Math.min(target, Math.max(0, (ahead - 4.5) * 2.2))
    }

    const forwardX = Math.sin(agent.heading)
    const forwardZ = Math.cos(agent.heading)
    const toPlayerX = playerX - agent.x
    const toPlayerZ = playerZ - agent.z
    const along = toPlayerX * forwardX + toPlayerZ * forwardZ
    const side = Math.abs(toPlayerX * forwardZ - toPlayerZ * forwardX)
    if (along > 0 && along < 13 && side < 2.6 && playerSpeed >= -1) {
      target = Math.min(target, Math.max(0, (along - 6) * 1.6))
    }

    return target
  }

  private advance(agent: Agent) {
    const dir = agent.dir
    if ((agent.t > EDGE && dir > 0) || (agent.t < -EDGE && dir < 0)) {
      agent.t = dir > 0 ? EDGE - 0.5 : -EDGE + 0.5
      agent.dir = dir > 0 ? -1 : 1
      agent.junction = agent.roadIndex + agent.dir
      return
    }

    if (agent.junction < 0 || agent.junction > GRID) return
    const junction = ROAD_LINES[agent.junction]
    const passed = dir > 0 ? agent.t >= junction : agent.t <= junction
    if (!passed) return

    if (Math.random() >= TURN_CHANCE) {
      agent.junction += dir
      return
    }

    const sign = agent.axis === 'z' ? 1 : -1
    const turnRight = Math.random() < 0.5
    const nextAxis: Agent['axis'] = agent.axis === 'z' ? 'x' : 'z'
    const nextDir = turnRight ? ((-dir * sign) as 1 | -1) : ((dir * sign) as 1 | -1)
    const nextT = ROAD_LINES[agent.roadIndex]
    const nextIndex = agent.junction

    agent.axis = nextAxis
    agent.roadIndex = nextIndex
    agent.dir = nextDir
    agent.junction = nextIndex + nextDir
    agent.t = nextAxis === 'x' ? junction : nextT
    if (nextAxis === 'z') agent.t = nextT
  }

  private resnap(agent: Agent) {
    const nearestX = ROAD_LINES.reduce((best, line) =>
      Math.abs(line - agent.x) < Math.abs(best - agent.x) ? line : best,
    )
    const nearestZ = ROAD_LINES.reduce((best, line) =>
      Math.abs(line - agent.z) < Math.abs(best - agent.z) ? line : best,
    )
    const useX = Math.abs(nearestZ - agent.z) < Math.abs(nearestX - agent.x)
    const line = useX ? nearestZ : nearestX
    const along = useX ? agent.x : agent.z
    const travel = useX ? agent.vx : agent.vz

    agent.axis = useX ? 'x' : 'z'
    agent.roadIndex = ROAD_LINES.indexOf(line)
    agent.t = THREE.MathUtils.clamp(along, -EDGE, EDGE)
    agent.dir = travel >= 0 ? 1 : -1
    agent.junction = agent.roadIndex + agent.dir
    agent.vx = 0
    agent.vz = 0
    agent.spin = 0
    agent.speed = 0
    agent.cruise = 6 + Math.random() * 4

    const offset = laneOffset(agent.axis, agent.dir)
    if (agent.axis === 'z') {
      agent.x = line + offset.x
      agent.z = agent.t
    } else {
      agent.z = line + offset.z
      agent.x = agent.t
    }
    agent.heading = headingFor(agent.axis, agent.dir)
  }

  private writeInstances() {
    this.agents.forEach((agent, index) => {
      const paint = PALETTE.cars[agent.colorIndex % PALETTE.cars.length]
      this.colour.set(paint)
      this.place(this.bodies, index, agent, 0, 0.86, 0, 2.0, 0.62, 4.3)
      this.bodies.setColorAt(index, this.colour)

      this.place(this.cabins, index, agent, 0, 1.56, 0.1, 1.82, 0.8, 2.35)
      this.cabins.setColorAt(index, this.colour)
      this.place(this.glass, index, agent, 0, 1.66, 0.1, 1.88, 0.34, 1.9)

      const spin = agent.knockTime > 0 ? 0 : agent.t * 3
      for (let slot = 0; slot < WHEELS.length; slot++) {
        const [wx, wz] = WHEELS[slot]
        const cos = Math.cos(agent.heading)
        const sin = Math.sin(agent.heading)
        this.dummy.position.set(
          agent.x + sin * wz + cos * wx,
          0.56,
          agent.z + cos * wz - sin * wx,
        )
        this.dummy.rotation.set(0, agent.heading, 0)
        this.dummy.rotateX(spin)
        this.dummy.scale.set(0.36, 1.12, 1.12)
        this.dummy.updateMatrix()
        this.wheels.setMatrixAt(index * 4 + slot, this.dummy.matrix)
      }
    })

    this.bodies.instanceMatrix.needsUpdate = true
    this.cabins.instanceMatrix.needsUpdate = true
    this.glass.instanceMatrix.needsUpdate = true
    this.wheels.instanceMatrix.needsUpdate = true
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true
    if (this.cabins.instanceColor) this.cabins.instanceColor.needsUpdate = true
  }

  private place(
    mesh: THREE.InstancedMesh,
    index: number,
    agent: Agent,
    ox: number,
    oy: number,
    oz: number,
    sx: number,
    sy: number,
    sz: number,
  ) {
    const cos = Math.cos(agent.heading)
    const sin = Math.sin(agent.heading)
    this.dummy.position.set(agent.x + sin * oz + cos * ox, oy, agent.z + cos * oz - sin * ox)
    this.dummy.rotation.set(0, agent.heading, 0)
    this.dummy.scale.set(sx, sy, sz)
    this.dummy.updateMatrix()
    mesh.setMatrixAt(index, this.dummy.matrix)
  }

  syncColliders() {
    this.agents.forEach((agent, index) => {
      const collider = this.colliders[index]
      collider.x = agent.x
      collider.z = agent.z
      collider.trafficIndex = index
    })
  }
}
