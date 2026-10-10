// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ steps: null as any, session: null as any }))
vi.mock('@/composables/useBackendFlowStages', () => ({
  useBackendFlowStages: () => ({
    projectedSteps: state.steps,
    isLoading: ref(false),
    error: ref(null),
  }),
}))
vi.mock('@/composables/useHomeSnapshots', () => ({
  useHomeSnapshots: () => ({ layoutThumbnails: ref([]) }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => state.session,
}))
import WorkspaceFlowDashboard from './WorkspaceFlowDashboard.vue'

describe('workspace flow diagram', () => {
  beforeEach(() => {
    state.steps = ref(
      [
        'Synthesis',
        'filler',
        'lvs',
        'drc',
        'postRouteLec',
        'RCX',
        'sta',
        'powerAnalysis',
        'Harden',
        'Signoff',
      ].map((stepId, order) => ({ stepId, name: stepId, order, state: 'succeeded' })),
    )
    state.session = reactive({
      workspaceContextId: 'context-a',
      projection: { data: { checklist: { status: 'ready', data: { findings: [] } } } },
    })
  })

  function render(stubTeleport = true) {
    return mount(WorkspaceFlowDashboard, {
      global: {
        stubs: {
          Teleport: stubTeleport,
          FlowRunControl: {
            props: ['step', 'status'],
            template: '<button class="run-control">{{ step || "Full flow" }}</button>',
          },
          Dialog: {
            props: ['visible'],
            template: '<div v-if="visible" class="test-dialog"><slot /></div>',
          },
          StepChecklistDialog: {
            props: ['step'],
            template: '<div class="checklist-dialog">{{ step.id }}</div>',
          },
          StepReportsDialog: {
            props: ['step'],
            template: '<div class="reports-dialog">{{ step.id }}</div>',
          },
          StepLogDialog: {
            props: ['step'],
            template: '<div class="log-dialog">{{ step.id }}</div>',
          },
          FlowSignoffCard: {
            props: ['eligible'],
            template: '<div class="signoff-milestone">Signoff</div>',
          },
        },
      },
    })
  }

  it('renders every node and dependency and opens step-specific dialogs without routing', async () => {
    const wrapper = render()
    expect(wrapper.findAll('.flow-step-card')).toHaveLength(10)
    expect(wrapper.get('svg').text()).toContain('RCX → sta')
    for (const [label, dialog] of [
      ['LVS checklist details', '.checklist-dialog'],
      ['LVS reports', '.reports-dialog'],
      ['LVS log', '.log-dialog'],
    ]) {
      await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
      expect(wrapper.get(dialog).text()).toBe('lvs')
    }
    state.session.workspaceContextId = 'context-b'
    await nextTick()
    expect(wrapper.find('.log-dialog').exists()).toBe(false)
  })

  it('keeps finalization gated when execution succeeded but verification evidence is absent', async () => {
    const wrapper = render()
    await wrapper.get('button[aria-label="Succeeded — run Harden"]').trigger('click')
    expect(wrapper.get('.test-dialog').text()).toContain('require all verification steps')
    expect(wrapper.findAll('.run-control')).toHaveLength(1)
    state.session.projection.data.checklist.data.findings = state.steps.value
      .slice(2, 8)
      .map((step: { stepId: string }) => ({
        id: step.stepId,
        step: step.stepId,
        state: 'pass',
        blocked: false,
        title: 'Passed',
        summary: '',
        category: 'gate',
      }))
    await nextTick()
    expect(wrapper.get('.step-run-action').text()).toContain('Harden')
    expect(wrapper.findAll('.run-control')).toHaveLength(2)
  })

  it('shows Signoff as a delivery milestone when ECC ends at Harden, without adding a runtime step', () => {
    state.steps.value = state.steps.value.filter(
      (step: { stepId: string }) => step.stepId !== 'Signoff',
    )
    const wrapper = render()
    expect(wrapper.find('.signoff-milestone').exists()).toBe(true)
    expect(wrapper.findAll('.flow-step-card')).toHaveLength(9)
    expect(wrapper.get('svg').text()).toContain('Harden → signoff-package-review')
  })

  it('expands the existing diagram without replacing any step cards', async () => {
    const wrapper = render(false)
    const step = wrapper.find('.flow-step-card').element
    await wrapper.get('button[aria-label="Expand flow diagram"]').trigger('click')
    expect(
      document.body.querySelector('.workspace-flow-dashboard.is-expanded'),
    ).not.toBeNull()
    expect(document.body.querySelector('.flow-step-card')).toBe(step)
    document.body
      .querySelector<HTMLButtonElement>('button[aria-label="Restore flow diagram"]')!
      .click()
    await nextTick()
    expect(wrapper.get('.workspace-flow-dashboard').classes()).not.toContain(
      'is-expanded',
    )
    expect(wrapper.find('.flow-step-card').element).toBe(step)
    wrapper.unmount()
  })
})
