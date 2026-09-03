// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStepDetail } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  dashboard: null as Record<string, unknown> | null,
  openReport: vi.fn(),
}))

vi.mock('@/composables/useStepDashboardData', () => ({
  useStepDashboardData: () => testState.dashboard,
}))
vi.mock('@/composables/useStepReportDialog', () => ({
  useStepReportDialog: () => ({
    openReport: testState.openReport,
    reportDialog: ref({
      label: '',
      content: '',
      error: '',
      loading: false,
      visible: false,
    }),
  }),
}))
vi.mock('@/composables/useStepConfigInfo', () => ({
  useStepConfigInfo: () => ({
    loading: ref(false),
    stepConfigParsed: ref(null),
    stepConfigPathResolved: ref(null),
  }),
}))
vi.mock('@/composables/useBackendFlowStages', () => ({
  useBackendFlowStages: () => ({ flowStages: ref([]) }),
}))
vi.mock('@/composables/useBackendWorkspaceQor', () => ({
  useBackendWorkspaceQor: () => ({ state: ref({ comparison: null }) }),
}))
vi.mock('@/composables/useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: ref({ path: '/project/ws-a' }) }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ chipViewer: { open: vi.fn() } }),
}))

import StepDashboard from './StepDashboard.vue'
import { snapshotStepDashboardData } from '@/composables/stepDashboardSnapshot'

function detail(): WorkspaceStepDetail {
  return {
    analysis: {
      metrics: [
        {
          id: 'core_area',
          display_name: 'Core Area',
          value: 6400,
          unit: 'um2',
          category: 'area_cost',
          direction: 'lower_is_better',
          scope: 'workspace',
          corner: null,
          analysis_group: 'place',
          rating: { gate: false, score: false, trend: true },
          project_role: 'trend',
          step_role: 'primary',
          confidence: 'high',
          source: {},
        },
      ],
      summary: null,
      hotspots: [],
      drc: { totalCount: null, hotspots: [], reportedCount: 0, truncated: false },
      sta: null,
      congestion: [],
      database: null,
      lvs: null,
      rcx: null,
    },
    artifacts: [
      {
        artifactId: 'layout-place',
        availability: 'missing',
        kind: 'layout_image',
        name: 'gcd_Place.png',
        stepId: 'Place',
      },
      {
        artifactId: 'report-place',
        availability: 'available',
        kind: 'report_text',
        name: 'MAX_125/RCworst/timing_max.rpt',
        sizeBytes: 1024,
        stepId: 'Place',
      },
    ],
    checklist: { findings: [] },
    step: { stepId: 'Place', order: 0, name: 'Place', state: 'succeeded' },
    subflow: { status: 'available', steps: [] },
  }
}

describe('StepDashboard committed Snapshot rendering', () => {
  beforeEach(() => {
    testState.openReport.mockReset()
    testState.dashboard = {
      currentStep: ref('Place'),
      data: ref(snapshotStepDashboardData(detail())),
      error: ref(null),
      loading: ref(false),
      refresh: vi.fn(),
    }
  })

  it('preserves metrics, preview availability, and report interaction', async () => {
    const wrapper = mount(StepDashboard, {
      global: {
        stubs: {
          Dialog: { template: '<div><slot /></div>' },
          StatusPieChart: true,
          StepConfigPanel: true,
          TimingAnalysisDialog: true,
          TimingCornerTable: true,
          TimingKpis: true,
          StepDataSummaryDialog: true,
          StepSnapshotPanel: true,
          CongestionPanel: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Core Area')
    expect(wrapper.text()).toContain('Layout preview is missing')
    expect(wrapper.text()).toContain('timing_max.rpt')
    expect(wrapper.text()).toContain('MAX_125 / RCworst')

    await wrapper.get('.report-list button').trigger('click')
    expect(testState.openReport).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'report-place' }),
    )
  })
})
