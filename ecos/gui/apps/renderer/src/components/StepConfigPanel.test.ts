// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { StepEnum } from '@/api/type'

vi.mock('@/composables/useStepConfigInfo', () => ({
  useStepConfigInfo: () => ({
    currentStep: computed(() => 'Floorplan'),
    hasFlowStep: computed(() => true),
    loading: ref(false),
    error: ref(null),
    runtimeMessages: ref([]),
    workspaceRevision: ref(1),
    isEmpty: computed(() => false),
    refetch: vi.fn(),
    stepConfigPathResolved: ref('Floorplan parameters'),
    stepConfigDisplay: computed(() => '{}'),
    stepConfigReadError: ref(null),
    stepConfigJsonInvalid: computed(() => false),
    stepConfigParameterCount: computed(() => 1),
    stepConfigParameterDescriptions: ref({}),
    stepConfigParsed: computed(() => ({ 'floorplan.core_util': 1.3 })),
    stepConfigDraft: ref({ 'floorplan.core_util': 1.3 }),
    stepConfigTextDraft: ref(''),
    hasStepConfigChanges: computed(() => true),
    isSavingStepConfig: ref(false),
    stepConfigSaveError: ref(
      'value 1.3 out of range [0.01, 1.0] for floorplan.core_util',
    ),
    isMutationLocked: computed(() => false),
    markStepConfigEditorInitialized: vi.fn(),
    saveStepConfig: vi.fn(),
    resetStepConfig: vi.fn(),
    reloadStepConfigFiles: vi.fn(),
  }),
}))

vi.mock('@/composables/useBaselineStepConfig', () => ({
  useBaselineStepConfig: () => ({
    status: ref('no-baseline'),
    noConfigReason: ref(null),
    baselineWorkspaceName: ref(null),
    baselineSource: ref(null),
    workspaceRevision: ref(null),
    configRelativePath: ref(null),
    configFileName: ref(null),
    rawText: ref(null),
    parameterDescriptions: ref({}),
    parsed: ref(null),
    jsonInvalid: ref(false),
    viewDraft: ref(null),
    error: ref(null),
  }),
}))

vi.mock('@/components/step-config/StepConfigDynamicView.vue', () => ({
  default: {
    name: 'StepConfigDynamicView',
    template: '<div class="step-config-dynamic-view" />',
  },
}))

import StepConfigPanel from './StepConfigPanel.vue'

describe('StepConfigPanel', () => {
  it('shows a visible banner when saving parameters fails', () => {
    const wrapper = mount(StepConfigPanel, {
      props: { step: StepEnum.FLOORPLAN },
      global: {
        stubs: {
          Textarea: true,
        },
      },
    })

    expect(wrapper.text()).toContain(
      'value 1.3 out of range [0.01, 1.0] for floorplan.core_util',
    )
  })
})
