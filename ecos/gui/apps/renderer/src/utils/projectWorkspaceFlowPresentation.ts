import type { ProjectWorkspaceFlowState } from '@ecos-studio/shared'
import type { ProjectFlowStatusHint } from './backendProjectManagement'

export function workspaceFlowHint(
  flow?: ProjectWorkspaceFlowState,
): ProjectFlowStatusHint {
  if (!flow) return { state: 'unstart', label: 'Loading status…' }
  if (flow.issue === 'unavailable')
    return { state: 'warning', label: 'Status unavailable' }
  if (flow.issue === 'interrupted') return { state: 'failed', label: 'Interrupted' }
  if (flow.running) {
    const step = Object.entries(flow.steps).find(([, state]) => state === 'running')?.[0]
    return { state: 'running', label: step ? `${step} running` : 'Running' }
  }
  const states = Object.values(flow.steps)
  if (!states.length) return { state: 'warning', label: 'Status unavailable' }
  if (states.includes('failed')) return { state: 'failed', label: 'Failed' }
  const completed = states.filter((state) =>
    ['success', 'reused', 'skipped', 'warning'].includes(state),
  ).length
  if (!completed) return { state: 'unstart', label: 'Not started' }
  if (completed !== states.length)
    return { state: 'unstart', label: `${completed}/${states.length} steps completed` }
  if (states.includes('warning'))
    return { state: 'warning', label: 'Completed with warnings' }
  return { state: 'success', label: 'Completed' }
}
