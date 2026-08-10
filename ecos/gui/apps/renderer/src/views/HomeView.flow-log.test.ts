import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

describe('HomeView flow run integration', () => {
  it('moves flow status and logs into the shared right workbench panel', () => {
    expect(homeViewSource).toContain('flow-title="Flow status"')
    expect(homeViewSource).toContain('<FlowLogPanel')
    expect(homeViewSource).toContain(
      '<template #right-log="{ selectedNode, selectedNodePinned }">',
    )
    expect(homeViewSource).toContain(':selected-node-pinned="selectedNodePinned"')
    expect(homeViewSource).toContain(
      ':execution-active="currentWorkspaceFlowExecutionActive"',
    )
    expect(homeViewSource).toContain(':log-rerun-affected-steps="flowLogRerunAffectedSteps"')
  })

  it('does not retain the removed overview or left-side flow panel', () => {
    expect(homeViewSource).not.toContain('Flow Overview')
    expect(homeViewSource).not.toContain('Runtime Monitoring')
    expect(homeViewSource).not.toContain('flow-log-fullscreen-overlay')
  })
})
