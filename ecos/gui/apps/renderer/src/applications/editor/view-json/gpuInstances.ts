import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js'
import type { ViewJsonInstanceChunk, ViewJsonOverviewInstance } from './overview'

const PLACED_INSTANCE_COLOR = 0x2563eb
const FIXED_INSTANCE_COLOR = 0xd97706
const PLACED_INSTANCE_ALPHA = 0.28
const FIXED_INSTANCE_ALPHA = 0.42

export interface GpuInstanceMeshBuffers {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  instanceCount: number
}

export interface GpuInstanceMeshGroups {
  placed: ViewJsonOverviewInstance[]
  fixed: ViewJsonOverviewInstance[]
}

export interface GpuInstanceMeshBufferGroups {
  placed: GpuInstanceMeshBuffers
  fixed: GpuInstanceMeshBuffers
}

type GpuInstanceMeshGroup = 'placed' | 'fixed'

export function splitGpuInstanceMeshGroups(
  instances: ViewJsonOverviewInstance[],
): GpuInstanceMeshGroups {
  const placed: ViewJsonOverviewInstance[] = []
  const fixed: ViewJsonOverviewInstance[] = []

  for (const inst of instances) {
    if (inst.status === 'FIXED') {
      fixed.push(inst)
    } else {
      placed.push(inst)
    }
  }

  return { placed, fixed }
}

export function buildGpuInstanceMeshBuffers(
  instances: ViewJsonOverviewInstance[],
): GpuInstanceMeshBuffers {
  return buildGpuInstanceMeshBuffersFromIterable(instances)
}

export function buildGpuInstanceMeshBuffersFromChunks(
  chunks: ViewJsonInstanceChunk[],
  group?: GpuInstanceMeshGroup,
): GpuInstanceMeshBuffers {
  let validInstanceCount = 0

  for (const chunk of chunks) {
    for (const inst of chunk.instances) {
      if (isRenderableGpuInstance(inst, group)) {
        validInstanceCount += 1
      }
    }
  }

  return buildGpuInstanceMeshBuffersFromIterable(iterChunkInstances(chunks), validInstanceCount, group)
}

export function buildGpuInstanceMeshBufferGroupsFromChunks(
  chunks: ViewJsonInstanceChunk[],
): GpuInstanceMeshBufferGroups {
  let placedInstanceCount = 0
  let fixedInstanceCount = 0

  for (const chunk of chunks) {
    for (const inst of chunk.instances) {
      if (!isRenderableGpuInstance(inst)) continue
      if (inst.status === 'FIXED') {
        fixedInstanceCount += 1
      } else {
        placedInstanceCount += 1
      }
    }
  }

  const placed = createEmptyGpuInstanceMeshBuffers(placedInstanceCount)
  const fixed = createEmptyGpuInstanceMeshBuffers(fixedInstanceCount)
  let placedIndex = 0
  let fixedIndex = 0

  for (const chunk of chunks) {
    for (const inst of chunk.instances) {
      if (!isRenderableGpuInstance(inst)) continue
      if (inst.status === 'FIXED') {
        writeGpuInstanceQuad(inst, fixedIndex, fixed.positions, fixed.uvs, fixed.indices)
        fixedIndex += 1
      } else {
        writeGpuInstanceQuad(inst, placedIndex, placed.positions, placed.uvs, placed.indices)
        placedIndex += 1
      }
    }
  }

  return { placed, fixed }
}

function* iterChunkInstances(chunks: ViewJsonInstanceChunk[]): Iterable<ViewJsonOverviewInstance> {
  for (const chunk of chunks) {
    yield* chunk.instances
  }
}

function buildGpuInstanceMeshBuffersFromIterable(
  instances: Iterable<ViewJsonOverviewInstance>,
  knownValidInstanceCount?: number,
  group?: GpuInstanceMeshGroup,
): GpuInstanceMeshBuffers {
  const validInstanceCount = knownValidInstanceCount ?? countValidGpuInstances(instances, group)
  const buffers = createEmptyGpuInstanceMeshBuffers(validInstanceCount)
  let i = 0

  for (const inst of instances) {
    if (!isRenderableGpuInstance(inst, group)) continue
    writeGpuInstanceQuad(inst, i, buffers.positions, buffers.uvs, buffers.indices)
    i += 1
  }

  return buffers
}

function createEmptyGpuInstanceMeshBuffers(instanceCount: number): GpuInstanceMeshBuffers {
  return {
    positions: new Float32Array(instanceCount * 8),
    uvs: new Float32Array(instanceCount * 8),
    indices: new Uint32Array(instanceCount * 6),
    instanceCount,
  }
}

function countValidGpuInstances(
  instances: Iterable<ViewJsonOverviewInstance>,
  group?: GpuInstanceMeshGroup,
): number {
  let count = 0

  for (const inst of instances) {
    if (isRenderableGpuInstance(inst, group)) {
      count += 1
    }
  }

  return count
}

function isRenderableGpuInstance(
  inst: ViewJsonOverviewInstance,
  group?: GpuInstanceMeshGroup,
): boolean {
  if (inst.world.w <= 0 || inst.world.h <= 0) return false
  if (!group) return true
  return group === 'fixed' ? inst.status === 'FIXED' : inst.status !== 'FIXED'
}

function writeGpuInstanceQuad(
  inst: ViewJsonOverviewInstance,
  index: number,
  positions: Float32Array,
  uvs: Float32Array,
  indices: Uint32Array,
): void {
  const { x, y, w, h } = inst.world
  const vertexOffset = index * 8
  const indexOffset = index * 6
  const baseVertex = index * 4
  const x1 = x + w
  const y1 = y + h

  positions.set([
    x, y,
    x1, y,
    x1, y1,
    x, y1,
  ], vertexOffset)
  uvs.set([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], vertexOffset)
  indices.set([
    baseVertex,
    baseVertex + 1,
    baseVertex + 2,
    baseVertex,
    baseVertex + 2,
    baseVertex + 3,
  ], indexOffset)
}

export class GpuInstanceMeshRenderer {
  readonly container = new Container()
  private placedMesh: Mesh<MeshGeometry> | null = null
  private fixedMesh: Mesh<MeshGeometry> | null = null

  constructor(parent: Container) {
    this.container.label = 'view-json-gpu-instance-meshes'
    parent.addChild(this.container)
  }

  render(instances: ViewJsonOverviewInstance[]): void {
    const groups = splitGpuInstanceMeshGroups(instances)

    this.placedMesh = this.replaceMesh(
      this.placedMesh,
      groups.placed,
      'view-json-gpu-placed-instances',
      PLACED_INSTANCE_COLOR,
      PLACED_INSTANCE_ALPHA,
    )
    this.fixedMesh = this.replaceMesh(
      this.fixedMesh,
      groups.fixed,
      'view-json-gpu-fixed-instances',
      FIXED_INSTANCE_COLOR,
      FIXED_INSTANCE_ALPHA,
    )
  }

  renderChunks(chunks: ViewJsonInstanceChunk[]): void {
    const buffers = buildGpuInstanceMeshBufferGroupsFromChunks(chunks)

    this.placedMesh = this.replaceMeshFromBuffers(
      this.placedMesh,
      buffers.placed,
      'view-json-gpu-placed-instances',
      PLACED_INSTANCE_COLOR,
      PLACED_INSTANCE_ALPHA,
    )
    this.fixedMesh = this.replaceMeshFromBuffers(
      this.fixedMesh,
      buffers.fixed,
      'view-json-gpu-fixed-instances',
      FIXED_INSTANCE_COLOR,
      FIXED_INSTANCE_ALPHA,
    )
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible
  }

  clear(): void {
    this.destroyMesh(this.placedMesh)
    this.destroyMesh(this.fixedMesh)
    this.placedMesh = null
    this.fixedMesh = null
  }

  destroy(): void {
    this.clear()
    if (this.container.parent) {
      this.container.parent.removeChild(this.container)
    }
    this.container.destroy()
  }

  private replaceMesh(
    current: Mesh<MeshGeometry> | null,
    instances: ViewJsonOverviewInstance[],
    label: string,
    color: number,
    alpha: number,
  ): Mesh<MeshGeometry> | null {
    this.destroyMesh(current)

    const buffers = buildGpuInstanceMeshBuffers(instances)
    return this.createMeshFromBuffers(buffers, label, color, alpha)
  }

  private replaceMeshFromBuffers(
    current: Mesh<MeshGeometry> | null,
    buffers: GpuInstanceMeshBuffers,
    label: string,
    color: number,
    alpha: number,
  ): Mesh<MeshGeometry> | null {
    this.destroyMesh(current)
    return this.createMeshFromBuffers(buffers, label, color, alpha)
  }

  private createMeshFromBuffers(
    buffers: GpuInstanceMeshBuffers,
    label: string,
    color: number,
    alpha: number,
  ): Mesh<MeshGeometry> | null {
    if (buffers.instanceCount === 0) return null

    const geometry = new MeshGeometry({
      positions: buffers.positions,
      uvs: buffers.uvs,
      indices: buffers.indices,
      shrinkBuffersToFit: true,
    })
    const mesh = new Mesh({
      geometry,
      texture: Texture.WHITE,
      label,
      tint: color,
      alpha,
    })

    this.container.addChild(mesh)
    return mesh
  }

  private destroyMesh(mesh: Mesh<MeshGeometry> | null): void {
    if (!mesh) return

    const { geometry } = mesh
    if (mesh.parent === this.container) {
      this.container.removeChild(mesh)
    }
    mesh.destroy()
    geometry.destroy()
  }
}
