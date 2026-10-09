import { describe, expect, it } from 'vitest'
import stepDashboardSource from './StepDashboard.vue?raw'
import frontendWorkspaceSource from '../views/FrontendWorkspaceView.vue?raw'

describe('workspace step baseline display', () => {
  it('keeps baseline comparisons out of the dashboard and QoR details', () => {
    expect(stepDashboardSource).not.toContain('useBackendWorkspaceQor')
    expect(stepDashboardSource).not.toContain('metric.baselineValue')
    expect(stepDashboardSource).not.toContain('metric.absoluteDelta')
    expect(stepDashboardSource).not.toContain('metric.comparisonState')
    expect(stepDashboardSource).not.toContain('qorMetricBaselineValue')
    expect(stepDashboardSource).not.toContain('qorMetricDeltaValue')
    expect(stepDashboardSource).toContain(
      'formatDashboardValue(metric.currentValue, metric.unit)',
    )
  })

  it('does not show baseline labels in frontend steps', () => {
    expect(frontendWorkspaceSource).not.toContain("label: 'Baseline'")
    expect(frontendWorkspaceSource).not.toContain('No Baseline')
    expect(frontendWorkspaceSource).not.toContain('No baseline')
    expect(frontendWorkspaceSource).not.toContain('simRegression.baseline_run_id')
    expect(frontendWorkspaceSource).not.toContain('reviewDelta.baseline')
  })
})
