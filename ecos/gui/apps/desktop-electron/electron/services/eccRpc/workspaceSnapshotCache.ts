import type { EccWorkspaceRuntimeSnapshot } from '@ecos-studio/shared'

export type DetachedWorkspaceSnapshot = Omit<
  EccWorkspaceRuntimeSnapshot,
  'workspaceHandle'
>

/**
 * An idle workspace can be requested by several renderer surfaces at once.
 * Coalescing the first bounded NFS read prevents those surfaces from competing
 * for Electron's I/O workers while preserving the last authoritative snapshot.
 */
export class WorkspaceSnapshotCache {
  private generation = 0
  private latest: DetachedWorkspaceSnapshot | null = null
  private pendingLoad: Promise<DetachedWorkspaceSnapshot> | null = null

  get(): DetachedWorkspaceSnapshot | null {
    return this.latest
  }

  set(snapshot: DetachedWorkspaceSnapshot): void {
    this.latest = snapshot
  }

  clear(): void {
    this.generation += 1
    this.latest = null
    this.pendingLoad = null
  }

  async loadIdle(
    directory: string,
    loader: (directory: string) => Promise<DetachedWorkspaceSnapshot>,
  ): Promise<DetachedWorkspaceSnapshot> {
    if (this.latest) return this.latest
    if (!this.pendingLoad) {
      const loadGeneration = this.generation
      const load = loader(directory).then((snapshot) => {
        if (this.generation === loadGeneration) {
          this.latest = snapshot
        }
        return snapshot
      })
      const pending = load.finally(() => {
        if (this.pendingLoad === pending) {
          this.pendingLoad = null
        }
      })
      this.pendingLoad = pending
    }
    return await this.pendingLoad
  }
}
