const DEFAULT_DIAGNOSTIC_IDLE_TIMEOUT_MS = 30_000

export interface RuntimeSidecarLifecycleOptions {
  captureFinalSnapshot(workspaceId: string): Promise<void>
  /** Close the sidecar; resolve { ok: false } when the close was deferred. */
  closeSidecar(): Promise<{ ok: boolean }>
  emitError(message: string): void
  emitIdle(): void
  hasActiveOperations(): boolean
  /** True while a start RPC window is open; release paths retry until it closes. */
  isStartWindow(): boolean
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
  private releaseRetryTimer: ReturnType<typeof setTimeout> | null = null
  private finalSnapshotTask: Promise<boolean> | null = null

  constructor(private readonly options: RuntimeSidecarLifecycleOptions) {}

  hasFinalSnapshotTask(): boolean {
    return this.finalSnapshotTask !== null
  }

  /** True while a failed operation is being retained for diagnostics. */
  /** True during the retention timer AND the asynchronous close that follows. */
  hasDiagnosticRetention(): boolean {
    return this.diagnosticReleaseTimer !== null || this.diagnosticCloseTask !== null
  }

  /** True while a release is scheduled to retry after a start window. */
  hasReleaseRetry(): boolean {
    return this.releaseRetryTimer !== null
  }

  waitForFinalSnapshot(): Promise<boolean> | null {
    return this.finalSnapshotTask
  }

  releaseAfterSuccessfulOperation(workspaceId: string): void {
    if (
      this.finalSnapshotTask ||
      this.options.hasActiveOperations() ||
      this.options.isStartWindow()
    ) {
      // A start RPC window is open; retry shortly so operation B (or its
      // registration) is not cut down by the snapshot/close below.
      if (!this.releaseRetryTimer) {
        this.releaseRetryTimer = setTimeout(() => {
          this.releaseRetryTimer = null
          this.releaseAfterSuccessfulOperation(workspaceId)
        }, 200)
      }
      return
    }
    this.cancelDiagnosticRelease()
    const task = this.finishSuccessfulOperation(workspaceId)
    this.finalSnapshotTask = task
    void task.then(
      (closed) => {
        if (this.finalSnapshotTask === task) {
          this.finalSnapshotTask = null
        }
        if (closed) this.options.emitIdle()
      },
      () => {
        // finishSuccessfulOperation never rejects; this branch cannot fire.
      },
    )
  }

  retainFailedOperationForDiagnostics(): void {
    if (
      this.options.hasActiveOperations() ||
      this.diagnosticReleaseTimer ||
      this.diagnosticCloseTask
    ) {
      return
    }
    const timeoutMs =
      this.options.diagnosticIdleTimeoutMs ?? DEFAULT_DIAGNOSTIC_IDLE_TIMEOUT_MS
    this.diagnosticReleaseTimer = setTimeout(() => {
      this.diagnosticReleaseTimer = null
      if (this.options.hasActiveOperations() || this.options.isStartWindow()) {
        // Retry after the start window closes.
        this.diagnosticReleaseTimer = setTimeout(() => {
          this.diagnosticReleaseTimer = null
          this.retainFailedOperationForDiagnostics()
        }, 200)
        return
      }
      // Keep retention flagged while the asynchronous close is running. A
      // deferred close re-arms the retention window for another attempt.
      const closeTask = this.options.closeSidecar().then(
        (result) => {
          this.diagnosticCloseTask = null
          if (result.ok) {
            this.options.emitIdle()
          } else {
            this.retainFailedOperationForDiagnostics()
          }
        },
        (error: unknown) => {
          this.diagnosticCloseTask = null
          this.options.emitError(errorMessage(error))
          // Surface the drain to the settings layer even on failure so
          // deferred applies can retry, and re-arm for another attempt.
          this.options.emitIdle()
          this.retainFailedOperationForDiagnostics()
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

  private async finishSuccessfulOperation(workspaceId: string): Promise<boolean> {
    try {
      await this.options.captureFinalSnapshot(workspaceId)
    } catch (error) {
      this.options.emitError(errorMessage(error))
      // Snapshot failed: the sidecar is still unclosed. Re-arm retention so a
      // later attempt can close it.
      this.retainFailedOperationForDiagnostics()
      return false
    }
    try {
      const result = await this.options.closeSidecar()
      if (!result.ok) {
        // The sidecar deferred the shutdown; re-arm the retention window so a
        // later attempt closes it once it really drains. No idle signal yet.
        this.retainFailedOperationForDiagnostics()
        return false
      }
      return true
    } catch (error) {
      this.options.emitError(errorMessage(error))
      this.retainFailedOperationForDiagnostics()
      return false
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
