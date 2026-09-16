export interface RuntimeSidecarLifecycleOptions {
  captureFinalSnapshot(workspaceId: string): Promise<void>
  closeSidecar(): Promise<void>
  emitError(message: string): void
  emitIdle(): void
  hasActiveOperations(): boolean
}

/**
 * Owns sidecar release after terminal operations. Successful operations save a
 * final snapshot first; failed operations retain the process briefly for
 * diagnostics, then release it without leaking a long-lived sidecar.
 */
export class RuntimeSidecarLifecycle {
  private finalSnapshotTask: Promise<void> | null = null
  private finalizationState: {
    issue?: string
    state: 'finalizing' | 'snapshot-failed'
    workspaceId: string
  } | null = null

  constructor(private readonly options: RuntimeSidecarLifecycleOptions) {}

  hasFinalSnapshotTask(): boolean {
    return this.finalSnapshotTask !== null
  }

  waitForFinalSnapshot(): Promise<void> | null {
    return this.finalSnapshotTask
  }

  finalization() {
    return this.finalizationState ? { ...this.finalizationState } : null
  }

  hasFinalizationBlocker(): boolean {
    return this.finalizationState !== null
  }

  finalizeOperation(workspaceId: string): void {
    if (this.finalSnapshotTask || this.options.hasActiveOperations()) return
    this.finalizationState = { state: 'finalizing', workspaceId }
    const task = this.finishOperation(workspaceId)
    this.finalSnapshotTask = task
    void task.finally(() => {
      if (this.finalSnapshotTask === task) {
        this.finalSnapshotTask = null
      }
      this.options.emitIdle()
    })
  }

  async retryFinalSnapshot(): Promise<boolean> {
    const workspaceId = this.finalizationState?.workspaceId
    if (!workspaceId || this.finalizationState?.state !== 'snapshot-failed') return false
    this.finalizeOperation(workspaceId)
    await this.finalSnapshotTask
    return this.finalizationState === null
  }

  private async finishOperation(workspaceId: string): Promise<void> {
    try {
      await this.options.captureFinalSnapshot(workspaceId)
      await this.options.closeSidecar()
      this.finalizationState = null
    } catch (error) {
      const issue = errorMessage(error)
      this.finalizationState = { issue, state: 'snapshot-failed', workspaceId }
      this.options.emitError(issue)
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? `Failed to persist final ECC snapshot: ${error.message}`
    : 'Failed to persist final ECC snapshot.'
}
