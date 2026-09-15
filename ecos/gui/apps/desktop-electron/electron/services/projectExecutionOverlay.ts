import {
  parseProjectManifestFlowStep,
  type BackendProjectActiveOperation,
  type BackendProjectExecutionInvalidatedEvent,
  type BackendProjectExecutionSnapshotResult,
  type EccRuntimeOperation,
  type ProjectStepStatus,
} from '@ecos-studio/shared'

export interface CommittedProjectWorkspace {
  engineeringWorkspaceId: string
  projectWorkspaceId: string
  stepStatuses: Record<string, ProjectStepStatus>
  workspaceRevision: number
}

type InvalidationListener = (
  windowId: number,
  event: BackendProjectExecutionInvalidatedEvent,
) => void

interface ExecutionContext {
  generation: number
  windowId: number
  workspaces: CommittedProjectWorkspace[]
}

export class ProjectExecutionOverlay {
  private readonly contexts = new Map<string, ExecutionContext>()
  private readonly listeners = new Set<InvalidationListener>()

  constructor(private readonly activeOperations: () => EccRuntimeOperation[]) {}

  register(windowId: number, contextId: string): void {
    this.contexts.set(contextId, { generation: 0, windowId, workspaces: [] })
  }

  unregister(contextId: string): void {
    this.contexts.delete(contextId)
  }

  setCommittedWorkspaces(
    contextId: string,
    workspaces: CommittedProjectWorkspace[],
  ): void {
    const context = this.contexts.get(contextId)
    if (context) context.workspaces = workspaces
  }

  get(windowId: number, contextId: string): BackendProjectExecutionSnapshotResult {
    const context = this.contexts.get(contextId)
    if (!context || context.windowId !== windowId) {
      return { ok: false, code: 'unknown-context' }
    }
    return {
      ok: true,
      projectComparisonContextId: contextId,
      generation: context.generation,
      data: {
        operations: projectOperations(this.activeOperations(), context.workspaces),
      },
    }
  }

  invalidate(): void {
    for (const [contextId, context] of this.contexts) {
      context.generation += 1
      const event = {
        generation: context.generation,
        projectComparisonContextId: contextId,
      }
      for (const listener of this.listeners) listener(context.windowId, event)
    }
  }

  onInvalidated(listener: InvalidationListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

function projectOperations(
  operations: EccRuntimeOperation[],
  workspaces: CommittedProjectWorkspace[],
): BackendProjectActiveOperation[] {
  const byEngineeringIdentity = new Map(
    workspaces.map((workspace) => [
      `${workspace.engineeringWorkspaceId}\0${workspace.workspaceRevision}`,
      workspace,
    ]),
  )
  return operations.flatMap((operation) =>
    projectOperation(operation, byEngineeringIdentity),
  )
}

function projectOperation(
  operation: EccRuntimeOperation,
  workspaces: Map<string, CommittedProjectWorkspace>,
): BackendProjectActiveOperation[] {
  if (
    (operation.state !== 'queued' && operation.state !== 'running') ||
    typeof operation.workspaceRevision !== 'number'
  ) {
    return []
  }
  const workspace = workspaces.get(
    `${operation.workspaceId}\0${operation.workspaceRevision}`,
  )
  if (!workspace) return []
  const step = parseProjectManifestFlowStep(operation.currentStep || operation.step)
  const committedStep = step ? workspace.stepStatuses[step] : undefined
  return [
    {
      cancelRequested: Boolean(operation.cancelRequested),
      engineeringWorkspaceId: operation.workspaceId,
      kind: operation.kind,
      operationId: operation.operationId,
      projectWorkspaceId: workspace.projectWorkspaceId,
      rerun: operation.rerun,
      state: operation.state,
      step:
        committedStep === 'success' ||
        committedStep === 'reused' ||
        committedStep === 'skipped'
          ? null
          : step,
      updatedAt: operation.updatedAt,
      workspaceRevision: operation.workspaceRevision,
    },
  ]
}
