import { ref, shallowReactive } from 'vue'

export const flowExecutionActive = ref(false)
const activeFlowWorkspaces = shallowReactive(new Set<string>())

function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function refreshGlobalFlowExecutionActive() {
  flowExecutionActive.value = activeFlowWorkspaces.size > 0
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
  refreshGlobalFlowExecutionActive()
}

export function isFlowExecutionActiveForWorkspace(
  path: string | undefined | null,
): boolean {
  return Boolean(path && activeFlowWorkspaces.has(normalizeWorkspacePath(path)))
}
