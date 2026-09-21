import type {
  DesktopShutdownStatus,
  EccBackgroundOperationProjection,
  EccBackgroundWorkspaceCreation,
} from '@ecos-studio/shared'

export interface ShutdownScope {
  kind: 'window' | 'application'
  windowId?: number
}

export interface ShutdownBlockerSummary {
  activeFlows: number
  details: string[]
  finalizations: number
  pendingCommands: number
  pendingCreations: number
  snapshotFailures: number
}

export function boundedShutdownIssue(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500)
}

export function idleShutdownStatus(): DesktopShutdownStatus {
  return {
    activeFlows: 0,
    attemptId: null,
    finalizations: 0,
    forceEligible: false,
    pendingCommands: 0,
    pendingCreations: 0,
    scope: null,
    snapshotFailures: 0,
    state: 'idle',
  }
}

export function emptyShutdownBlockers(): ShutdownBlockerSummary {
  return {
    activeFlows: 0,
    details: [],
    finalizations: 0,
    pendingCommands: 0,
    pendingCreations: 0,
    snapshotFailures: 0,
  }
}

export function buildShutdownBlockers(options: {
  acceptedWorkByWindow: ReadonlyMap<number, number>
  creations: EccBackgroundWorkspaceCreation[]
  handleOwners: ReadonlyMap<string, number>
  projection: EccBackgroundOperationProjection
  scope: ShutdownScope
}): ShutdownBlockerSummary {
  const { projection, scope } = options
  const inScope = (workspaceHandle: string) =>
    scope.kind === 'application' ||
    options.handleOwners.get(workspaceHandle) === scope.windowId
  const operations = projection.operations.filter((operation) =>
    inScope(operation.workspaceHandle),
  )
  const finalizations = projection.finalizations.filter((item) =>
    inScope(item.workspaceHandle),
  )
  const pendingCreations = options.creations.filter(
    (item) =>
      item.status === 'active' &&
      (scope.kind === 'application' || item.ownerWindowId === scope.windowId),
  )
  const pendingCommands = [...options.acceptedWorkByWindow].reduce(
    (total, [windowId, count]) =>
      total + (scope.kind === 'application' || scope.windowId === windowId ? count : 0),
    0,
  )
  return {
    activeFlows: operations.length,
    details: boundedDetails([
      ...operations.map(
        (operation) =>
          `${workspaceName(operation.workspaceDirectory)}: ${operation.currentStep || operation.state}`,
      ),
      ...finalizations.map(
        (item) => `${workspaceName(item.workspaceDirectory)}: ${item.state}`,
      ),
      ...pendingCreations.map(
        (item) => `${workspaceName(item.targetDirectory ?? '')}: creating Workspace`,
      ),
      ...(pendingCommands
        ? [`${pendingCommands} accepted backend command(s) finishing`]
        : []),
    ]),
    finalizations: finalizations.filter((item) => item.state === 'finalizing').length,
    pendingCommands,
    pendingCreations: pendingCreations.length,
    snapshotFailures: finalizations.filter((item) => item.state === 'snapshot-failed')
      .length,
  }
}

export function hasShutdownBlockers(blockers: ShutdownBlockerSummary): boolean {
  return (
    blockers.activeFlows +
      blockers.finalizations +
      blockers.pendingCommands +
      blockers.pendingCreations +
      blockers.snapshotFailures >
    0
  )
}

export function workspaceHandlesInShutdownScope(
  handleOwners: ReadonlyMap<string, number>,
  scope: ShutdownScope,
): string[] | undefined {
  return scope.kind === 'application'
    ? undefined
    : [...handleOwners]
        .filter(([, windowId]) => windowId === scope.windowId)
        .map(([workspaceHandle]) => workspaceHandle)
}

function boundedDetails(details: string[]): string[] {
  const visible = details.slice(0, 8)
  return details.length > visible.length
    ? [...visible, `${details.length - visible.length} more item(s)`]
    : visible
}

function workspaceName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/g, '')
      .split(/[\\/]/)
      .pop() ||
    path ||
    'Workspace'
  )
}
