import { describe, expect, it } from 'vitest'
import frontendWorkspaceViewSource from './FrontendWorkspaceView.vue?raw'

describe('FrontendWorkspaceView QoR layout', () => {
  it('keeps QoR discoverable from every frontend step', () => {
    expect(frontendWorkspaceViewSource).toContain("activeTab = 'qor'")
    expect(frontendWorkspaceViewSource).toContain('v-else-if="activeTab === \'qor\'"')
    expect(frontendWorkspaceViewSource).toContain(':qor="currentStepQor"')
    expect(frontendWorkspaceViewSource).toContain("id: 'qor'")
    expect(frontendWorkspaceViewSource).toContain("label: 'QoR'")
    expect(frontendWorkspaceViewSource).toContain('QoR · {{ frontendQorStatusLabel')
    expect(frontendWorkspaceViewSource).toContain('frontendQorForStepState(')
    expect(frontendWorkspaceViewSource).toContain('currentStep.value?.state')
    expect(frontendWorkspaceViewSource).toContain('stale: Boolean(stepStaleReason.value)')
  })
})
