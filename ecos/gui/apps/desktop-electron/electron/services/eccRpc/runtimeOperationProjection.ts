import type {
  EccBackgroundFinalization,
  EccBackgroundOperation,
  EccBackgroundOperationOutcome,
  EccBackgroundOperationProjection,
} from '@ecos-studio/shared'
import type { EccWorkspaceRuntime } from './workspaceRuntime'

interface RuntimeOperationProjectionOptions {
  handleEntries(): Iterable<[string, string]>
  runtimeForDirectory(directory: string): EccWorkspaceRuntime | undefined
  runtimes(): EccWorkspaceRuntime[]
}

export class RuntimeOperationProjection {
  private generation = 0
  private readonly listeners = new Set<(generation: number) => void>()
  private readonly releasedOutcomes: EccBackgroundOperationOutcome[] = []
  private signature = '{"finalizations":[],"operations":[],"outcomes":[]}'

  constructor(private readonly options: RuntimeOperationProjectionOptions) {}

  snapshot(): EccBackgroundOperationProjection {
    return {
      creations: [],
      finalizations: this.finalizations(),
      generation: this.generation,
      operations: this.operations(),
      outcomes: this.outcomes(),
    }
  }

  onInvalidated(listener: (generation: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  rememberReleased(
    runtime: EccWorkspaceRuntime,
    workspaceHandle: string,
    workspaceDirectory: string,
  ): void {
    for (const operation of runtime.recentOperationOutcomes()) {
      const outcome = projectOperation(operation, workspaceDirectory, workspaceHandle)
      const key = outcomeKey(outcome)
      const existing = this.releasedOutcomes.findIndex(
        (candidate) => outcomeKey(candidate) === key,
      )
      if (existing >= 0) this.releasedOutcomes.splice(existing, 1)
      this.releasedOutcomes.push(outcome)
    }
    if (this.releasedOutcomes.length > 64) {
      this.releasedOutcomes.splice(0, this.releasedOutcomes.length - 64)
    }
  }

  refresh(): void {
    const snapshot = this.snapshot()
    const signature = JSON.stringify({
      finalizations: snapshot.finalizations,
      operations: snapshot.operations,
      outcomes: snapshot.outcomes,
    })
    if (signature === this.signature) return
    this.signature = signature
    this.generation += 1
    for (const listener of this.listeners) listener(this.generation)
  }

  private operations(): EccBackgroundOperation[] {
    return this.contexts().flatMap(({ runtime, workspaceDirectory, workspaceHandle }) =>
      runtime.activeOperations().map((operation) => ({
        ...projectOperation(operation, workspaceDirectory, workspaceHandle),
      })),
    )
  }

  private finalizations(): EccBackgroundFinalization[] {
    return this.contexts().flatMap(({ runtime, workspaceDirectory, workspaceHandle }) => {
      const finalization = runtime.finalization()
      return finalization
        ? [
            {
              ...finalization,
              ...(finalization.issue ? { issue: bounded(finalization.issue, 500) } : {}),
              workspaceDirectory,
              workspaceHandle,
            },
          ]
        : []
    })
  }

  private outcomes(): EccBackgroundOperationOutcome[] {
    const outcomes = new Map<string, EccBackgroundOperationOutcome>()
    for (const outcome of this.releasedOutcomes)
      outcomes.set(outcomeKey(outcome), outcome)
    for (const { runtime, workspaceDirectory, workspaceHandle } of this.contexts()) {
      for (const operation of runtime.recentOperationOutcomes()) {
        const outcome = projectOperation(operation, workspaceDirectory, workspaceHandle)
        outcomes.set(outcomeKey(outcome), outcome)
      }
    }
    return [...outcomes.values()].slice(-64)
  }

  private contexts(): Array<{
    runtime: EccWorkspaceRuntime
    workspaceDirectory: string
    workspaceHandle: string
  }> {
    const entries = [...this.options.handleEntries()]
    return this.options.runtimes().flatMap((runtime) => {
      const context = entries.find(
        ([, directory]) => this.options.runtimeForDirectory(directory) === runtime,
      )
      return context
        ? [
            {
              runtime,
              workspaceDirectory: context[1],
              workspaceHandle: context[0],
            },
          ]
        : []
    })
  }
}

function outcomeKey(outcome: EccBackgroundOperationOutcome): string {
  return `${outcome.runtimeInstanceId ?? ''}\0${outcome.workspaceId}\0${outcome.operationId}\0${outcome.state}`
}

function projectOperation(
  operation: ReturnType<EccWorkspaceRuntime['activeOperations']>[number],
  workspaceDirectory: string,
  workspaceHandle: string,
): EccBackgroundOperation {
  return {
    ...operation,
    currentStep: bounded(operation.currentStep, 256),
    currentTool: bounded(operation.currentTool, 256),
    error: operation.error
      ? {
          code: bounded(operation.error.code, 128),
          message: bounded(operation.error.message, 500),
        }
      : null,
    result: null,
    step: bounded(operation.step, 256),
    workspaceDirectory,
    workspaceHandle,
  }
}

function bounded(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}
