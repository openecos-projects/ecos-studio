import { ref, shallowReactive } from 'vue'

export const flowExecutionActive = ref(false)
const backendProjectionReady = ref(true)
const activeFlowWorkspaces = shallowReactive(new Set<string>())
const knownBackendWorkspaces = shallowReactive(new Set<string>())
const activeBackendWorkspaces = shallowReactive(new Set<string>())
const unknownBackendWorkspaces = shallowReactive(new Set<string>())

function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function refreshGlobalFlowExecutionActive() {
  flowExecutionActive.value =
    activeBackendWorkspaces.size > 0 ||
    [...activeFlowWorkspaces].some((path) => !knownBackendWorkspaces.has(path))
}

export function markFlowExecutionActiveForWorkspace(path: string): void {
  const workspacePath = normalizeWorkspacePath(path)
  if (!workspacePath) return
  activeFlowWorkspaces.add(workspacePath)
  refreshGlobalFlowExecutionActive()
}

export function clearFlowExecutionActiveForWorkspace(path: string): void {
  const workspacePath = normalizeWorkspacePath(path)
  if (!workspacePath) return
  activeFlowWorkspaces.delete(workspacePath)
  refreshGlobalFlowExecutionActive()
}

export function resetFlowExecutionState(): void {
  activeFlowWorkspaces.clear()
  knownBackendWorkspaces.clear()
  activeBackendWorkspaces.clear()
  unknownBackendWorkspaces.clear()
  backendProjectionReady.value = true
  refreshGlobalFlowExecutionActive()
}

export function setBackendFlowProjectionReady(ready: boolean): void {
  backendProjectionReady.value = ready
}

export function setBackendFlowProjectionUnknown(paths: Iterable<string>): void {
  unknownBackendWorkspaces.clear()
  for (const path of paths) {
    const normalized = normalizeWorkspacePath(path)
    if (normalized) unknownBackendWorkspaces.add(normalized)
  }
}

export function isBackendFlowProjectionUnknown(path?: string | null): boolean {
  if (!backendProjectionReady.value) return true
  if (!path) return unknownBackendWorkspaces.size > 0
  return unknownBackendWorkspaces.has(normalizeWorkspacePath(path))
}

export function isFlowExecutionActiveForWorkspace(
  path: string | undefined | null,
): boolean {
  if (!path) return false
  const workspacePath = normalizeWorkspacePath(path)
  return knownBackendWorkspaces.has(workspacePath)
    ? activeBackendWorkspaces.has(workspacePath)
    : activeFlowWorkspaces.has(workspacePath)
}

export function activeFlowExecutionWorkspacePaths(): string[] {
  return [
    ...new Set([
      ...activeBackendWorkspaces,
      ...[...activeFlowWorkspaces].filter((path) => !knownBackendWorkspaces.has(path)),
    ]),
  ]
}

export function updateAuthoritativeBackendFlowState(
  knownPaths: Iterable<string>,
  activePaths: Iterable<string>,
): void {
  const nextKnown = new Set<string>()
  for (const path of knownPaths) {
    const normalized = normalizeWorkspacePath(path)
    if (normalized) nextKnown.add(normalized)
  }
  for (const path of knownBackendWorkspaces) {
    if (!nextKnown.has(path)) activeFlowWorkspaces.delete(path)
  }
  knownBackendWorkspaces.clear()
  for (const path of nextKnown) knownBackendWorkspaces.add(path)
  activeBackendWorkspaces.clear()
  for (const path of activePaths) {
    const normalized = normalizeWorkspacePath(path)
    if (normalized) activeBackendWorkspaces.add(normalized)
  }
  refreshGlobalFlowExecutionActive()
}
