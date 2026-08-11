type HomeRunArtifactResetListener = (projectPath: string) => void

export interface WorkspaceRerunPrepared {
  affectedSteps: readonly string[]
  projectPath: string
  scope: 'flow' | 'step'
  targetStep: string
}

type WorkspaceRerunPreparedListener = (event: WorkspaceRerunPrepared) => void

const resetListeners = new Set<HomeRunArtifactResetListener>()
const rerunPreparedListeners = new Set<WorkspaceRerunPreparedListener>()
const pendingResetProjectPaths = new Set<string>()
const awaitingBackendStartProjectPaths = new Set<string>()
const agentPreparedRerunHomeProjectPaths = new Set<string>()

export function normalizeWorkspaceProjectPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

export function requestHomeRunArtifactReset(projectPath: string): void {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!normalizedProjectPath) return
  awaitingBackendStartProjectPaths.delete(normalizedProjectPath)
  pendingResetProjectPaths.add(normalizedProjectPath)
  for (const listener of resetListeners) {
    listener(normalizedProjectPath)
  }
}

/**
 * Broadcasts ECC's exact rerun boundary to currently mounted workspace views.
 * The runtime event connection is scoped to the active workspace, so this must
 * never initiate reads for another project.
 */
export function notifyWorkspaceRerunPrepared(event: WorkspaceRerunPrepared): void {
  const projectPath = normalizeWorkspaceProjectPath(event.projectPath)
  if (!projectPath) return

  const affectedSteps = Array.from(
    new Set(
      event.affectedSteps
        .map((step) => step.trim())
        .filter(Boolean),
    ),
  )
  const preparedEvent: WorkspaceRerunPrepared = {
    ...event,
    affectedSteps,
    projectPath,
    targetStep: event.targetStep.trim(),
  }
  for (const listener of rerunPreparedListeners) {
    listener(preparedEvent)
  }
}

export function onWorkspaceRerunPrepared(
  listener: WorkspaceRerunPreparedListener,
): () => void {
  rerunPreparedListeners.add(listener)
  return () => {
    rerunPreparedListeners.delete(listener)
  }
}

export function markHomeRunArtifactResetAwaitingBackendStart(projectPath: string): void {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!normalizedProjectPath) return
  awaitingBackendStartProjectPaths.add(normalizedProjectPath)
}

export function clearHomeRunArtifactResetAwaitingBackendStart(projectPath: string): void {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!normalizedProjectPath) return
  awaitingBackendStartProjectPaths.delete(normalizedProjectPath)
}

export function isHomeRunArtifactResetAwaitingBackendStart(projectPath: string): boolean {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  return awaitingBackendStartProjectPaths.has(normalizedProjectPath)
}

export function markAgentWorkspaceRerunHomePrepared(projectPath: string): void {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!normalizedProjectPath) return
  agentPreparedRerunHomeProjectPaths.add(normalizedProjectPath)
}

export function clearAgentWorkspaceRerunHomePrepared(projectPath: string): void {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!normalizedProjectPath) return
  agentPreparedRerunHomeProjectPaths.delete(normalizedProjectPath)
}

export function isAgentWorkspaceRerunHomePrepared(projectPath: string): boolean {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  return agentPreparedRerunHomeProjectPaths.has(normalizedProjectPath)
}

export function isHomeRunArtifactResetPending(projectPath: string): boolean {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  return pendingResetProjectPaths.has(normalizedProjectPath)
}

export function onHomeRunArtifactReset(
  listener: HomeRunArtifactResetListener,
): () => void {
  resetListeners.add(listener)
  return () => {
    resetListeners.delete(listener)
  }
}

export function consumePendingHomeRunArtifactReset(projectPath: string): boolean {
  const normalizedProjectPath = normalizeWorkspaceProjectPath(projectPath)
  if (!pendingResetProjectPaths.has(normalizedProjectPath)) return false
  pendingResetProjectPaths.delete(normalizedProjectPath)
  return true
}
