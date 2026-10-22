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
        'antennaCheck',
        'postRouteLec',
        'RCX',
        'sta',
        'powerAnalysis',
        'emir',
        'Harden',
        'Signoff',
      ].map((stepId, order) => ({ stepId, name: stepId, order, state: 'succeeded' })),
    )
    state.session = reactive({
      workspaceContextId: 'context-a',
      projection: { data: { checklist: { status: 'ready', data: { findings: [] } } } },
    })
  })

  function render(stubTeleport = true, withOverview = false) {
    return mount(WorkspaceFlowDashboard, {
      slots: withOverview
        ? {
            overview: '<article class="test-overview">Status overview</article>',
            metrics: '<article class="test-metrics">Key metrics</article>',
          }
        : {},
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
    expect(wrapper.text()).not.toContain('Checks converge before Harden and Signoff')
    expect(wrapper.findAll('.flow-step-card')).toHaveLength(12)
    expect(wrapper.get('svg').text()).toContain('RCX → sta')
    for (const [label, dialog] of [
      ['LVS checklist details', '.checklist-dialog'],
      ['LVS reports', '.reports-dialog'],
      ['LVS log', '.log-dialog'],
      ['Antenna Check checklist details', '.checklist-dialog'],
      ['EMIR reports', '.reports-dialog'],
      ['EMIR log', '.log-dialog'],
    ]) {
      await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
      expect(wrapper.get(dialog).text()).toBe(
        label.startsWith('Antenna')
          ? 'antennaCheck'
          : label.startsWith('EMIR')
            ? 'emir'
            : 'lvs',
      )
    }
    state.session.workspaceContextId = 'context-b'
    await nextTick()
    expect(wrapper.find('.log-dialog').exists()).toBe(false)
  })

  it('keeps the status overview outside the movable canvas when fitting', async () => {
    const wrapper = render(false, true)
    const overview = wrapper.get('.test-overview').element
    const viewport = wrapper.get('.flow-scroll').element as HTMLElement
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 360 },
    })
    expect(wrapper.get('.flow-overview').text()).toContain('Status overview')
    expect(wrapper.get('.flow-overview').element.parentElement).toBe(
      wrapper.get('.flow-viewport').element,
    )
    expect(wrapper.get('.flow-scroll').element.parentElement).toBe(
      wrapper.get('.flow-viewport').element,
    )
    expect(wrapper.find('.flow-scroll .test-overview').exists()).toBe(false)
    expect(wrapper.get('.flow-metrics').element.parentElement).toBe(
      wrapper.get('.flow-viewport').element,
    )
    const metrics = wrapper.get('.test-metrics').element
    await wrapper.get('input[aria-label="Flow diagram zoom"]').setValue('1')
    expect(wrapper.get('.test-overview').element).toBe(overview)
    await wrapper.get('button[aria-label="Fit flow diagram"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(wrapper.get('.flow-overview .test-overview').element).toBe(overview)
    expect(wrapper.get('.flow-metrics .test-metrics').element).toBe(metrics)
    await nextTick()
    expect(wrapper.get('.test-overview').element).toBe(overview)
    wrapper.unmount()
  })

  it('keeps finalization gated when execution succeeded but verification evidence is absent', async () => {
    const wrapper = render()
    await wrapper.get('button[aria-label="Succeeded — run Harden"]').trigger('click')
    expect(wrapper.get('.test-dialog').text()).toContain(
      'require mandatory verification steps',
    )
    expect(wrapper.findAll('.run-control')).toHaveLength(1)
    state.session.projection.data.checklist.data.findings = state.steps.value
      .filter((step: { stepId: string }) =>
        ['lvs', 'drc', 'postRouteLec', 'RCX', 'sta', 'powerAnalysis'].includes(
          step.stepId,
        ),
      )
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

  it('shows advisory attention without preventing Harden when mandatory checks pass', async () => {
    const required = ['lvs', 'drc', 'postRouteLec', 'RCX', 'sta', 'powerAnalysis']
    const advisory = ['antennaCheck', 'emir']
    state.steps.value = state.steps.value.map((step: { stepId: string }) => ({
      ...step,
      state: advisory.includes(step.stepId) ? 'failed' : 'succeeded',
    }))
    state.session.projection.data.checklist.data.findings = [
      ...required,
      ...advisory,
    ].map((step) => ({
      id: `flow.${step}.completed`,
      step,
      state: advisory.includes(step) ? 'warning' : 'pass',
      blocked: false,
      title: step,
      summary: '',
      category: 'flow',
    }))
    const wrapper = render()
    for (const label of ['Antenna Check', 'EMIR']) {
      const button = wrapper.get(`button[aria-label="${label} checklist details"]`)
      expect(
        button.element.closest('.flow-step-card')?.getAttribute('data-check-state'),
      ).toBe('warning')
    }
    await wrapper.get('button[aria-label="Succeeded — run Harden"]').trigger('click')
    expect(wrapper.get('.step-run-action').text()).toContain('Harden')
    wrapper.unmount()
  })

  it('shows Signoff as a delivery milestone when ECC ends at Harden, without adding a runtime step', () => {
    state.steps.value = state.steps.value.filter(
      (step: { stepId: string }) => step.stepId !== 'Signoff',
    )
    const wrapper = render()
    expect(wrapper.find('.signoff-milestone').exists()).toBe(true)
    expect(wrapper.findAll('.flow-step-card')).toHaveLength(11)
    expect(wrapper.get('svg').text()).toContain('Harden → signoff-package-review')
  })

  it('fits and centers the existing diagram without replacing any step cards', async () => {
    const wrapper = render(false)
    const step = wrapper.find('.flow-step-card').element
    const viewport = wrapper.get('.flow-scroll').element as HTMLElement
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    })
    const canvas = wrapper.get('.flow-canvas').element as HTMLElement
    const graphWidth = Number.parseFloat(canvas.style.width)
    const graphHeight = Number.parseFloat(canvas.style.height)
    const expectedZoom = Math.max(
      0.25,
      Math.min(
        1.5,
        Math.floor(Math.min((800 - 48) / graphWidth, (600 - 48) / graphHeight) * 20) / 20,
      ),
    )

    await wrapper.get('button[aria-label="Fit flow diagram"]').trigger('click')
    await nextTick()
    await nextTick()
    await nextTick()

    expect(wrapper.get('output').text()).toBe(`${Math.round(expectedZoom * 100)}%`)
    expect(wrapper.find('.flow-step-card').element).toBe(step)
    const canvasLeft = Number.parseFloat(canvas.style.left)
    const canvasTop = Number.parseFloat(canvas.style.top)
    expect(viewport.scrollLeft).toBeCloseTo(
      Math.max(0, canvasLeft + (graphWidth * expectedZoom) / 2 - 400),
    )
    expect(viewport.scrollTop).toBeCloseTo(
      Math.max(0, canvasTop + (graphHeight * expectedZoom) / 2 - 300),
    )
    expect(wrapper.find('.workspace-flow-dashboard').classes()).not.toContain(
      'is-expanded',
    )
    await nextTick()
    wrapper.unmount()
  })

  it('zooms continuously with the slider and clamps Ctrl-wheel zoom to its bounds', async () => {
    const wrapper = render()
    const slider = wrapper.get('input[aria-label="Flow diagram zoom"]')
    expect(slider.attributes('type')).toBe('range')
    await slider.setValue('1.1')
    expect(wrapper.get('output').text()).toBe('110%')
    expect(wrapper.get('.flow-canvas').attributes('style')).toContain('scale(1.1)')
    await wrapper.get('.flow-scroll').trigger('wheel', { deltaY: -100 })
    expect(wrapper.get('output').text()).toBe('110%')
    await wrapper.get('.flow-scroll').trigger('wheel', { ctrlKey: true, deltaY: -100 })
    expect(wrapper.get('output').text()).toBe('115%')
    await slider.setValue('1.5')
    await wrapper.get('.flow-scroll').trigger('wheel', { ctrlKey: true, deltaY: -100 })
    expect(wrapper.get('output').text()).toBe('150%')
    await slider.setValue('0.25')
    await wrapper.get('.flow-scroll').trigger('wheel', { ctrlKey: true, deltaY: 100 })
    expect(wrapper.get('output').text()).toBe('25%')
    wrapper.unmount()
  })

  it('preserves the Ctrl-wheel pointer anchor instead of returning to the first step', async () => {
    const wrapper = render(false)
    await nextTick()
    const viewport = wrapper.get('.flow-scroll').element as HTMLElement
    viewport.scrollLeft = 100
    viewport.scrollTop = 200
    const wheel = Object.assign(new Event('wheel', { cancelable: true }), {
      ctrlKey: true,
      deltaY: -100,
      clientX: 25,
      clientY: 50,
    })
    viewport.dispatchEvent(wheel)
    await nextTick()
    await nextTick()
    expect(wheel.defaultPrevented).toBe(true)
    expect(viewport.scrollLeft).toBeCloseTo((125 / 0.75) * 0.8 - 25)
    expect(viewport.scrollTop).toBeCloseTo((250 / 0.75) * 0.8 - 50)
    wrapper.unmount()
  })

  it('shows grabbing on left-button press and pans after the drag threshold', async () => {
    const wrapper = render(false)
    await nextTick()
    const viewport = wrapper.get('.flow-scroll')
    const element = viewport.element as HTMLElement
    element.scrollLeft = 100
    element.scrollTop = 200
    const canvas = wrapper.get('.flow-canvas')
    await canvas.trigger('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    expect(viewport.classes()).toContain('is-panning')
    await viewport.trigger('pointermove', {
      pointerId: 1,
      buttons: 1,
      clientX: 98,
      clientY: 99,
    })
    expect(element.scrollLeft).toBe(100)
    expect(viewport.classes()).toContain('is-panning')
    await viewport.trigger('pointermove', {
      pointerId: 1,
      buttons: 1,
      clientX: 70,
      clientY: 60,
    })
    expect(element.scrollLeft).toBe(130)
    expect(element.scrollTop).toBe(240)
    expect(viewport.classes()).toContain('is-panning')
    await viewport.trigger('pointerup', { pointerId: 1 })
    expect(viewport.classes()).not.toContain('is-panning')
    const click = new MouseEvent('click', { cancelable: true, bubbles: true })
    element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    await viewport.trigger('pointermove', {
      pointerId: 1,
      buttons: 1,
      clientX: 20,
      clientY: 20,
    })
    expect(element.scrollLeft).toBe(130)
    wrapper.unmount()
  })

  it('does not pan from action buttons, right mouse button, or touch input', async () => {
    const wrapper = render(false)
    await nextTick()
    const viewport = wrapper.get('.flow-scroll')
    const element = viewport.element as HTMLElement
    element.scrollLeft = 100
    for (const [target, pointerType, button] of [
      [wrapper.get('.flow-step-card'), 'mouse', 0],
      [wrapper.get('button[aria-label="LVS reports"]'), 'mouse', 0],
      [wrapper.get('.flow-canvas'), 'mouse', 2],
      [wrapper.get('.flow-canvas'), 'touch', 0],
    ] as const) {
      await target.trigger('pointerdown', {
        pointerId: 1,
        pointerType,
        isPrimary: true,
        button,
        clientX: 100,
        clientY: 100,
      })
      await viewport.trigger('pointermove', {
        pointerId: 1,
        buttons: 1,
        clientX: 20,
        clientY: 20,
      })
      expect(element.scrollLeft).toBe(100)
      expect(viewport.classes()).not.toContain('is-panning')
    }
    await wrapper.get('button[aria-label="LVS reports"]').trigger('click')
    expect(wrapper.get('.reports-dialog').text()).toBe('lvs')
    wrapper.unmount()
  })

  it('cleans up a pan on cancellation, lost capture, window blur, and workspace change', async () => {
    const wrapper = render(false)
    await nextTick()
    const viewport = wrapper.get('.flow-scroll')
    const canvas = wrapper.get('.flow-canvas')
    for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'workspace']) {
      await canvas.trigger('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: 100,
        clientY: 100,
      })
      await viewport.trigger('pointermove', {
        pointerId: 1,
        buttons: 1,
        clientX: 70,
        clientY: 60,
      })
      expect(viewport.classes()).toContain('is-panning')
      if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      else if (reason === 'workspace') state.session.workspaceContextId = 'context-b'
      else await viewport.trigger(reason, { pointerId: 1 })
      await nextTick()
      expect(viewport.classes()).not.toContain('is-panning')
    }
    wrapper.unmount()
  })
})
