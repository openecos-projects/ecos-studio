import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js'
import type { ViewJsonInstanceChunk, ViewJsonOverviewInstance } from './overview'
import {
  GPU_FIXED_INSTANCE_ALPHA,
  GPU_FIXED_INSTANCE_COLOR,
  GPU_INSTANCE_OUTLINE_ALPHA,
  GPU_PLACED_INSTANCE_ALPHA,
  GPU_PLACED_INSTANCE_COLOR,
  GpuInstanceChunkBufferCache,
  buildGpuInstanceMeshBufferGroupsFromCachedChunks,
  buildGpuInstanceMeshBuffers,
  buildGpuInstanceOutlineMeshBufferGroupsFromCachedChunks,
  buildGpuInstanceOutlineMeshBuffers,
  splitGpuInstanceMeshGroups,
  type GpuInstanceMeshBuffers,
} from './gpuInstanceBuffers'

export class GpuInstanceMeshRenderer {
  readonly container = new Container()
  private placedMesh: Mesh<MeshGeometry> | null = null
  private fixedMesh: Mesh<MeshGeometry> | null = null
  private placedOutlineMesh: Mesh<MeshGeometry> | null = null
  private fixedOutlineMesh: Mesh<MeshGeometry> | null = null
  private readonly chunkBufferCache = new GpuInstanceChunkBufferCache()

  constructor(parent: Container) {
    this.container.label = 'view-json-gpu-instance-meshes'
    parent.addChild(this.container)
  }

  render(instances: ViewJsonOverviewInstance[], outlineWidth = 0): void {
    const groups = splitGpuInstanceMeshGroups(instances)

    this.placedMesh = this.replaceMesh(
      this.placedMesh,
      groups.placed,
      'view-json-gpu-placed-instances',
      GPU_PLACED_INSTANCE_COLOR,
      GPU_PLACED_INSTANCE_ALPHA,
    )
    this.fixedMesh = this.replaceMesh(
      this.fixedMesh,
      groups.fixed,
      'view-json-gpu-fixed-instances',
      GPU_FIXED_INSTANCE_COLOR,
      GPU_FIXED_INSTANCE_ALPHA,
    )
    this.placedOutlineMesh = this.replaceOutlineMesh(
      this.placedOutlineMesh,
      groups.placed,
      outlineWidth,
      'view-json-gpu-placed-instance-outlines',
      GPU_PLACED_INSTANCE_COLOR,
    )
    this.fixedOutlineMesh = this.replaceOutlineMesh(
      this.fixedOutlineMesh,
      groups.fixed,
      outlineWidth,
      'view-json-gpu-fixed-instance-outlines',
      GPU_FIXED_INSTANCE_COLOR,
    )
  }

  renderChunks(chunks: ViewJsonInstanceChunk[], outlineWidth = 0): void {
    const buffers = buildGpuInstanceMeshBufferGroupsFromCachedChunks(
      chunks,
      this.chunkBufferCache,
    )
    const outlineBuffers = outlineWidth > 0
      ? buildGpuInstanceOutlineMeshBufferGroupsFromCachedChunks(
        chunks,
        this.chunkBufferCache,
        outlineWidth,
      )
      : null

    this.placedMesh = this.replaceMeshFromBuffers(
      this.placedMesh,
      buffers.placed,
      'view-json-gpu-placed-instances',
      GPU_PLACED_INSTANCE_COLOR,
      GPU_PLACED_INSTANCE_ALPHA,
    )
    this.fixedMesh = this.replaceMeshFromBuffers(
      this.fixedMesh,
      buffers.fixed,
      'view-json-gpu-fixed-instances',
      GPU_FIXED_INSTANCE_COLOR,
      GPU_FIXED_INSTANCE_ALPHA,
    )
    this.placedOutlineMesh = this.replaceOutlineMeshFromBuffers(
      this.placedOutlineMesh,
      outlineBuffers?.placed ?? null,
      'view-json-gpu-placed-instance-outlines',
      GPU_PLACED_INSTANCE_COLOR,
    )
    this.fixedOutlineMesh = this.replaceOutlineMeshFromBuffers(
      this.fixedOutlineMesh,
      outlineBuffers?.fixed ?? null,
      'view-json-gpu-fixed-instance-outlines',
      GPU_FIXED_INSTANCE_COLOR,
    )
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible
  }

  getCacheStats(): { chunkBufferCacheSize: number } {
    return {
      chunkBufferCacheSize: this.chunkBufferCache.size,
    }
  }

  clear(): void {
    this.destroyMesh(this.placedMesh)
    this.destroyMesh(this.fixedMesh)
    this.destroyMesh(this.placedOutlineMesh)
    this.destroyMesh(this.fixedOutlineMesh)
    this.placedMesh = null
    this.fixedMesh = null
    this.placedOutlineMesh = null
    this.fixedOutlineMesh = null
  }

  resetCache(): void {
    this.chunkBufferCache.clear()
  }

  destroy(): void {
    this.clear()
    this.resetCache()
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

  private replaceOutlineMesh(
    current: Mesh<MeshGeometry> | null,
    instances: ViewJsonOverviewInstance[],
    outlineWidth: number,
    label: string,
    color: number,
  ): Mesh<MeshGeometry> | null {
    this.destroyMesh(current)
    if (outlineWidth <= 0) return null

    const buffers = buildGpuInstanceOutlineMeshBuffers(instances, outlineWidth)
    return this.createMeshFromBuffers(buffers, label, color, GPU_INSTANCE_OUTLINE_ALPHA)
  }

  private replaceOutlineMeshFromBuffers(
    current: Mesh<MeshGeometry> | null,
    buffers: GpuInstanceMeshBuffers | null,
    label: string,
    color: number,
  ): Mesh<MeshGeometry> | null {
    this.destroyMesh(current)
    if (!buffers) return null

    return this.createMeshFromBuffers(buffers, label, color, GPU_INSTANCE_OUTLINE_ALPHA)
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
