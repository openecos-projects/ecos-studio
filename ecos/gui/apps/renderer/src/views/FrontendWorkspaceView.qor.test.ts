import { describe, expect, it } from 'vitest'
import frontendQorPanelSource from '@/components/frontend/FrontendWorkspaceQorPanel.vue?raw'
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
    expect(frontendWorkspaceViewSource).toContain('running: currentStepQorRunning.value')
    expect(frontendWorkspaceViewSource).not.toContain('running: runBusy.value')
    expect(frontendWorkspaceViewSource).toContain('stale: Boolean(stepStaleReason.value)')
  })

  it('refreshes the selected step QoR as soon as that step completes', () => {
    expect(frontendWorkspaceViewSource).toContain(
      'detailRequestStepName.value.trim().toLowerCase() === stepKey',
    )
    expect(frontendWorkspaceViewSource).toMatch(
      /if \(\s*isCompleted &&[\s\S]*?detailRequestStepName\.value\.trim\(\)\.toLowerCase\(\) === stepKey[\s\S]*?void loadDetail\(\)/,
    )
  })

  it('keeps long QoR and hotspot reports scrollable', () => {
    expect(frontendQorPanelSource).toContain('height: 100%')
    expect(frontendQorPanelSource).toContain('max-height: 100%')
    expect(frontendQorPanelSource).toContain('max-height: clamp(160px, 38vh, 360px)')
    expect(frontendQorPanelSource).toContain('overflow-y: auto')
    expect(frontendQorPanelSource).toContain('scrollbar-gutter: stable')
    expect(frontendQorPanelSource).toContain('aria-label="QoR hotspots"')
  })
})
