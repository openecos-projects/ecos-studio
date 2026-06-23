import type { ViewJsonInstanceChunk, ViewJsonOverviewInstance } from './overview'

export const GPU_PLACED_INSTANCE_COLOR = 0xbfdbfe
export const GPU_FIXED_INSTANCE_COLOR = 0xfed7aa
export const GPU_PLACED_INSTANCE_ALPHA = 1
export const GPU_FIXED_INSTANCE_ALPHA = 1
export const GPU_INSTANCE_OUTLINE_ALPHA = 0.78

const GPU_OUTLINE_QUADS_PER_INSTANCE = 4
export const GPU_OUTLINE_WIDTH_CACHE_STEP = 0.25

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

export type GpuInstanceMeshGroup = 'placed' | 'fixed'

interface CachedGpuInstanceChunkBuffers {
  signature: string
  fill: GpuInstanceMeshBufferGroups
  outlines: Map<number, GpuInstanceMeshBufferGroups>
}

export class GpuInstanceChunkBufferCache {
  private readonly chunks = new Map<string, CachedGpuInstanceChunkBuffers>()

  get size(): number {
    return this.chunks.size
  }

  getFillBuffers(chunk: ViewJsonInstanceChunk): GpuInstanceMeshBufferGroups {
    return this.getOrCreateCachedChunk(chunk).fill
  }

  getOutlineBuffers(
    chunk: ViewJsonInstanceChunk,
    outlineWidth: number,
  ): GpuInstanceMeshBufferGroups {
    const cached = this.getOrCreateCachedChunk(chunk)
    const cacheWidth = getGpuInstanceOutlineCacheWidth(outlineWidth)
    const existing = cached.outlines.get(cacheWidth)
    if (existing) return existing

    const buffers = buildGpuInstanceOutlineMeshBufferGroupsFromChunks([chunk], cacheWidth)
    cached.outlines.set(cacheWidth, buffers)
    return buffers
  }

  clear(): void {
    this.chunks.clear()
  }

  private getOrCreateCachedChunk(chunk: ViewJsonInstanceChunk): CachedGpuInstanceChunkBuffers {
    const signature = getGpuInstanceChunkBufferSignature(chunk)
    const existing = this.chunks.get(chunk.key)
    if (existing?.signature === signature) return existing

    const cached = {
      signature,
      fill: buildGpuInstanceMeshBufferGroupsFromChunks([chunk]),
      outlines: new Map<number, GpuInstanceMeshBufferGroups>(),
    }
    this.chunks.set(chunk.key, cached)
    return cached
  }
}

export function getGpuInstanceOutlineCacheWidth(outlineWidth: number): number {
  if (!Number.isFinite(outlineWidth) || outlineWidth <= 0) return 0
  return Math.max(
    GPU_OUTLINE_WIDTH_CACHE_STEP,
    Math.round(outlineWidth / GPU_OUTLINE_WIDTH_CACHE_STEP) * GPU_OUTLINE_WIDTH_CACHE_STEP,
  )
}

export function getGpuInstanceChunkBufferSignature(chunk: ViewJsonInstanceChunk): string {
  return `${chunk.key}:${chunk.instances.map((inst) => {
    const { x, y, w, h } = inst.world
    return `${inst.id}:${inst.status}:${x}:${y}:${w}:${h}`
  }).join('|')}`
}

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

export function buildGpuInstanceOutlineMeshBuffers(
  instances: ViewJsonOverviewInstance[],
  outlineWidth: number,
): GpuInstanceMeshBuffers {
  const renderable = instances.filter(inst => isRenderableGpuInstance(inst))
  const buffers = createEmptyGpuInstanceMeshBuffers(
    renderable.length * GPU_OUTLINE_QUADS_PER_INSTANCE,
  )
  let quadIndex = 0

  for (const inst of renderable) {
    quadIndex = writeGpuInstanceOutlineQuads(inst, outlineWidth, quadIndex, buffers)
  }

  return buffers
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

export function buildGpuInstanceMeshBufferGroupsFromCachedChunks(
  chunks: ViewJsonInstanceChunk[],
  cache: GpuInstanceChunkBufferCache,
): GpuInstanceMeshBufferGroups {
  const groups = chunks.map(chunk => cache.getFillBuffers(chunk))
  return combineGpuInstanceMeshBufferGroups(groups)
}

export function buildGpuInstanceOutlineMeshBufferGroupsFromChunks(
  chunks: ViewJsonInstanceChunk[],
  outlineWidth: number,
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

  const placed = createEmptyGpuInstanceMeshBuffers(
    placedInstanceCount * GPU_OUTLINE_QUADS_PER_INSTANCE,
  )
  const fixed = createEmptyGpuInstanceMeshBuffers(
    fixedInstanceCount * GPU_OUTLINE_QUADS_PER_INSTANCE,
  )
  let placedIndex = 0
  let fixedIndex = 0

  for (const chunk of chunks) {
    for (const inst of chunk.instances) {
      if (!isRenderableGpuInstance(inst)) continue
      if (inst.status === 'FIXED') {
        fixedIndex = writeGpuInstanceOutlineQuads(inst, outlineWidth, fixedIndex, fixed)
      } else {
        placedIndex = writeGpuInstanceOutlineQuads(inst, outlineWidth, placedIndex, placed)
      }
    }
  }

  return { placed, fixed }
}

export function buildGpuInstanceOutlineMeshBufferGroupsFromCachedChunks(
  chunks: ViewJsonInstanceChunk[],
  cache: GpuInstanceChunkBufferCache,
  outlineWidth: number,
): GpuInstanceMeshBufferGroups {
  const groups = chunks.map(chunk => cache.getOutlineBuffers(chunk, outlineWidth))
  return combineGpuInstanceMeshBufferGroups(groups)
}

function combineGpuInstanceMeshBufferGroups(
  groups: GpuInstanceMeshBufferGroups[],
): GpuInstanceMeshBufferGroups {
  return {
    placed: combineGpuInstanceMeshBuffers(groups.map(group => group.placed)),
    fixed: combineGpuInstanceMeshBuffers(groups.map(group => group.fixed)),
  }
}

function combineGpuInstanceMeshBuffers(
  buffersList: GpuInstanceMeshBuffers[],
): GpuInstanceMeshBuffers {
  const instanceCount = buffersList.reduce((sum, buffers) => sum + buffers.instanceCount, 0)
  const buffers = createEmptyGpuInstanceMeshBuffers(instanceCount)
  let quadOffset = 0

  for (const source of buffersList) {
    if (source.instanceCount === 0) continue
    buffers.positions.set(source.positions, quadOffset * 8)
    buffers.uvs.set(source.uvs, quadOffset * 8)

    for (let index = 0; index < source.indices.length; index += 1) {
      buffers.indices[quadOffset * 6 + index] = source.indices[index] + quadOffset * 4
    }
    quadOffset += source.instanceCount
  }

  return buffers
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

function writeGpuInstanceOutlineQuads(
  inst: ViewJsonOverviewInstance,
  outlineWidth: number,
  startIndex: number,
  buffers: GpuInstanceMeshBuffers,
): number {
  const { x, y, w, h } = inst.world
  const x1 = x + w
  const y1 = y + h
  const lineW = Math.min(outlineWidth, Math.max(0, w / 2), Math.max(0, h / 2))
  let index = startIndex

  writeGpuRectQuad(x, y, x1, y + lineW, index, buffers)
  index += 1
  writeGpuRectQuad(x, y1 - lineW, x1, y1, index, buffers)
  index += 1
  writeGpuRectQuad(x, y + lineW, x + lineW, y1 - lineW, index, buffers)
  index += 1
  writeGpuRectQuad(x1 - lineW, y + lineW, x1, y1 - lineW, index, buffers)
  index += 1

  return index
}

function writeGpuRectQuad(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  index: number,
  buffers: GpuInstanceMeshBuffers,
): void {
  const vertexOffset = index * 8
  const indexOffset = index * 6
  const baseVertex = index * 4

  buffers.positions.set([
    x0, y0,
    x1, y0,
    x1, y1,
    x0, y1,
  ], vertexOffset)
  buffers.uvs.set([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], vertexOffset)
  buffers.indices.set([
    baseVertex,
    baseVertex + 1,
    baseVertex + 2,
    baseVertex,
    baseVertex + 2,
    baseVertex + 3,
  ], indexOffset)
}
