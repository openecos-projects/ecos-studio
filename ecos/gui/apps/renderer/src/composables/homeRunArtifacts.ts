type HomeRunArtifactResetListener = (projectPath: string) => void

const resetListeners = new Set<HomeRunArtifactResetListener>()
const pendingResetProjectPaths = new Set<string>()
const awaitingBackendStartProjectPaths = new Set<string>()

function normalizeProjectPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

export function requestHomeRunArtifactReset(projectPath: string): void {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  if (!normalizedProjectPath) return
  awaitingBackendStartProjectPaths.delete(normalizedProjectPath)
  pendingResetProjectPaths.add(normalizedProjectPath)
  for (const listener of resetListeners) {
    listener(normalizedProjectPath)
  }
}

export function markHomeRunArtifactResetAwaitingBackendStart(projectPath: string): void {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  if (!normalizedProjectPath) return
  awaitingBackendStartProjectPaths.add(normalizedProjectPath)
}

export function clearHomeRunArtifactResetAwaitingBackendStart(projectPath: string): void {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  if (!normalizedProjectPath) return
  awaitingBackendStartProjectPaths.delete(normalizedProjectPath)
}

export function isHomeRunArtifactResetAwaitingBackendStart(projectPath: string): boolean {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  return awaitingBackendStartProjectPaths.has(normalizedProjectPath)
}

export function isHomeRunArtifactResetPending(projectPath: string): boolean {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  return pendingResetProjectPaths.has(normalizedProjectPath)
}

export function onHomeRunArtifactReset(listener: HomeRunArtifactResetListener): () => void {
  resetListeners.add(listener)
  return () => {
    resetListeners.delete(listener)
  }
}

export function consumePendingHomeRunArtifactReset(projectPath: string): boolean {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  if (!pendingResetProjectPaths.has(normalizedProjectPath)) return false
  pendingResetProjectPaths.delete(normalizedProjectPath)
  return true
}
