const DEFAULT_DIAGNOSTIC_IDLE_TIMEOUT_MS = 30_000

export interface RuntimeSidecarLifecycleOptions {
  captureFinalSnapshot(workspaceId: string): Promise<void>
  closeSidecar(): Promise<void>
  emitError(message: string): void
  emitIdle(): void
  hasActiveOperations(): boolean
  diagnosticIdleTimeoutMs?: number
}

/**
 * Owns sidecar release after terminal operations. Successful operations save a
 * final snapshot first; failed operations retain the process briefly for
 * diagnostics, then release it without leaking a long-lived sidecar.
 */
export class RuntimeSidecarLifecycle {
  private diagnosticReleaseTimer: ReturnType<typeof setTimeout> | null = null
  /** The asynchronous sidecar close that follows the retention timer. */
  private diagnosticCloseTask: Promise<void> | null = null
  private finalSnapshotTask: Promise<void> | null = null

  constructor(private readonly options: RuntimeSidecarLifecycleOptions) {}

  hasFinalSnapshotTask(): boolean {
    return this.finalSnapshotTask !== null
  }

  /** True while a failed operation is being retained for diagnostics. */
  /** True during the retention timer AND the asynchronous close that follows. */
  hasDiagnosticRetention(): boolean {
    return this.diagnosticReleaseTimer !== null || this.diagnosticCloseTask !== null
  }

  waitForFinalSnapshot(): Promise<void> | null {
    return this.finalSnapshotTask
  }

  releaseAfterSuccessfulOperation(workspaceId: string): void {
    if (this.finalSnapshotTask || this.options.hasActiveOperations()) return
    this.cancelDiagnosticRelease()
    const task = this.finishSuccessfulOperation(workspaceId)
    this.finalSnapshotTask = task
    void task.finally(() => {
      if (this.finalSnapshotTask === task) {
        this.finalSnapshotTask = null
      }
      this.options.emitIdle()
    })
  }

  retainFailedOperationForDiagnostics(): void {
    if (this.options.hasActiveOperations() || this.diagnosticReleaseTimer) return
    const timeoutMs =
      this.options.diagnosticIdleTimeoutMs ?? DEFAULT_DIAGNOSTIC_IDLE_TIMEOUT_MS
    this.diagnosticReleaseTimer = setTimeout(() => {
      this.diagnosticReleaseTimer = null
      if (this.options.hasActiveOperations()) return
      // Keep retention flagged while the asynchronous close is running.
      const closeTask = this.options.closeSidecar().then(
        () => {
          this.diagnosticCloseTask = null
          this.options.emitIdle()
        },
        (error: unknown) => {
          this.diagnosticCloseTask = null
          this.options.emitError(errorMessage(error))
        },
      )
      this.diagnosticCloseTask = closeTask
    }, timeoutMs)
  }

  cancelDiagnosticRelease(): void {
    if (!this.diagnosticReleaseTimer) return
    clearTimeout(this.diagnosticReleaseTimer)
    this.diagnosticReleaseTimer = null
  }

  private async finishSuccessfulOperation(workspaceId: string): Promise<void> {
    try {
      await this.options.captureFinalSnapshot(workspaceId)
      await this.options.closeSidecar()
    } catch (error) {
      this.options.emitError(errorMessage(error))
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? `Failed to persist final ECC snapshot: ${error.message}`
    : 'Failed to persist final ECC snapshot.'
}
