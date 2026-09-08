// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({
  getModel: vi.fn(),
}))

vi.mock('@/composables/useBackendFlowStages', () => ({
  useBackendFlowStages: () => ({
    dynamicFlowStages: ref([
      { label: 'Synthesis', path: 'Synthesis', icon: 'synth', tool: 'yosys' },
      { label: 'CTS', path: 'CTS', icon: 'cts', tool: 'ecc' },
      { label: 'DRC', path: 'drc', icon: 'drc', tool: 'ecc' },
    ]),
    error: ref(null),
    isLoading: ref(false),
  }),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ workspaceCreationModel: { get: testState.getModel } }),
}))

import WorkspaceStepConfigDialog from './WorkspaceStepConfigDialog.vue'

describe('WorkspaceStepConfigDialog', () => {
  beforeEach(() => {
    testState.getModel.mockReset().mockResolvedValue({
      discovery: {
        parameterCatalog: [{ appliesTo: 'all' }, { appliesTo: 'cts' }],
      },
    })
  })

  it('shows only flow steps with catalog parameters', async () => {
    const wrapper = mount(WorkspaceStepConfigDialog, {
      global: { stubs: { StepConfigPanel: true } },
    })
    await flushPromises()

    expect(
      wrapper.findAll('.workspace-step-config-list button').map((item) => item.text()),
    ).toEqual(['SynthesisYosys', 'CTSECC'])
    expect(wrapper.text()).not.toContain('DRC')
  })
})
