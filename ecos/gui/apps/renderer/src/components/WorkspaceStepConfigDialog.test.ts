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
      { label: 'Floorplan', path: 'Floorplan', icon: 'floorplan', tool: 'ecc' },
      { label: 'Place', path: 'place', icon: 'place', tool: 'dreamplace' },
      { label: 'CTS', path: 'CTS', icon: 'cts', tool: 'ecc' },
      { label: 'Route', path: 'route', icon: 'route', tool: 'ecc' },
      { label: 'Legalization', path: 'legalization', icon: 'legal', tool: 'dreamplace' },
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
        parameterCatalog: [
          { id: 'design.frequency_mhz', appliesTo: 'synthesis' },
          { id: 'flow.run_analysis', appliesTo: 'all' },
          { id: 'floorplan.core_util', appliesTo: 'floorplan' },
          { id: 'floorplan.aspect_ratio', appliesTo: 'floorplan' },
          { id: 'place.target_density', appliesTo: 'placement' },
          { id: 'cts.max_fanout', appliesTo: 'cts' },
          { id: 'route.top_layer', appliesTo: 'routing' },
        ],
      },
    })
  })

  it('shows only flow steps with catalog parameters', async () => {
    const wrapper = mount(WorkspaceStepConfigDialog, {
      global: {
        stubs: {
          StepConfigPanel: {
            template:
              '<div class="step-config-root"><div class="workspace-step-config-heading"></div></div>',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.findAll('.workspace-step-config-heading')).toHaveLength(2)
    expect(
      wrapper.findAll('.workspace-step-config-list button').map((item) => item.text()),
    ).toEqual([
      'SynthesisYosys · 2 params',
      'FloorplanECC · 2 params',
      'PlaceDreamPlace · 1 param',
      'CTSECC · 1 param',
      'RouteECC · 1 param',
    ])
    expect(wrapper.text()).not.toContain('DRC')
    expect(wrapper.text()).not.toContain('Legalization')
  })
})
