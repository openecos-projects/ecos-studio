// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StaPanel from './StaPanel.vue'

const testState = vi.hoisted(() => ({
  getArtifact: vi.fn(),
  session: null as Record<string, any> | null,
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ backendWorkspace: { getArtifact: testState.getArtifact } }),
}))
vi.mock('@/stores/backendWorkspaceSession', () => ({
  useBackendWorkspaceSession: () => testState.session,
}))

const corner = 'MAX_125/RCworst'
const timingArtifacts = ['timing_summary', 'timing_paths'].map((kind) => ({
  artifactId: kind,
  availability: 'available' as const,
  kind,
  name: `${corner}/${kind}.json`,
  stepId: 'sta',
  timingCorner: corner,
}))
const timingIssuesArtifact = {
  artifactId: 'sta_timing_issues',
  availability: 'available' as const,
  kind: 'sta_timing_issues',
  name: 'sta_timing_issues.json',
  stepId: 'sta',
}

describe('StaPanel', () => {
  beforeEach(() => {
    testState.session = reactive({
      generation: 0,
      workspaceContextId: 'context-a',
      projection: {
        data: { revision: { status: 'ready', data: { workspaceRevision: 35 } } },
      },
    })
    testState.getArtifact.mockReset().mockImplementation(async (request) => ({
      ...request,
      artifact: {
        status: 'ready',
        data: {
          artifactId: request.artifactId,
          timingSummary: {
            corner,
            meetsTiming: true,
            setup: { wns: 7.457, tns: 0, violationCount: 0, frequencyMhz: 393 },
            hold: { wns: 0.315, tns: 0, violationCount: 0 },
          },
          timingPaths: {
            corner,
            pathLimit: 20,
            paths: [
              {
                pathId: 'timing_path_1',
                analysisType: 'setup',
                slackNs: 7.457,
                startPoint: 'u0/Q',
                endPoint: 'u1/D',
                pathGroup: 'clk',
                stages: [{ pin: 'u0/Q', cell: 'DFF', delayNs: 0.05, arrivalNs: 0.1 }],
              },
            ],
          },
          timingIssues: { missingCorners: [], issues: [] },
        },
      },
    }))
  })

  function create() {
    return mount(StaPanel, {
      props: { model: null, criticalPaths: null, timingArtifacts, timingIssuesArtifact },
      global: {
        stubs: {
          TimingWnsChart: true,
          Dialog: { props: ['visible'], template: '<div v-if="visible"><slot /></div>' },
        },
      },
    })
  }

  it('shows corner paths when the issue preview is empty and removes baseline content', async () => {
    const wrapper = create()
    await vi.waitFor(() => expect(wrapper.find('.timing-path-card').exists()).toBe(true))
    expect(wrapper.find('.timing-corner-selector select').element).toHaveProperty(
      'value',
      corner,
    )
    expect(wrapper.find('summary').text()).toContain('u0/Q → u1/D')
    expect(wrapper.text()).toContain('Tool path limit per analysis type')
    expect(wrapper.text()).not.toContain('baseline')
    expect(wrapper.text()).not.toContain('Cross-run Convergence')
    const button = wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('View full timing issues'))!
    await button.trigger('click')
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('No timing issues were reported'),
    )
    expect(wrapper.find('.timing-path-card').exists()).toBe(true)
    wrapper.unmount()
  })

  it('reloads summaries and paths from the current revision on demand', async () => {
    const wrapper = create()
    await vi.waitFor(() => expect(wrapper.find('.timing-path-card').exists()).toBe(true))
    testState.getArtifact.mockClear()
    await wrapper
      .findAll('button')
      .find((entry) => entry.text().includes('Reload timing'))!
      .trigger('click')
    await vi.waitFor(() => expect(testState.getArtifact).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(wrapper.find('.timing-path-card').exists()).toBe(true))
    wrapper.unmount()
  })
})
