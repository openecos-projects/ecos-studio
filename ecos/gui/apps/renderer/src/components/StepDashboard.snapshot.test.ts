// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStepDetail } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  dashboard: null as Record<string, unknown> | null,
  openReport: vi.fn(),
  chipViewerOpen: vi.fn(),
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
  getDesktopApi: () => ({ chipViewer: { open: testState.chipViewerOpen } }),
}))

import StepDashboard from './StepDashboard.vue'
import dashboardSource from './StepDashboard.vue?raw'
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
          category: 'area',
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
    testState.chipViewerOpen.mockReset()
    testState.dashboard = {
      currentStep: ref('Place'),
      data: ref(snapshotStepDashboardData(detail())),
      error: ref(null),
      loadTimingCorner: vi.fn(),
      loading: ref(false),
      refresh: vi.fn(),
      timingDetailErrors: ref({}),
      timingDetailLoading: ref([]),
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

  it('keeps scrollable data highlights aligned to the top', () => {
    expect(dashboardSource).toMatch(/\.data-highlights\s*{[^}]*align-content: start/s)
  })

  it('opens the macro placement edit session from preFloorplan geometry', async () => {
    const preFloorplanDetail = detail()
    preFloorplanDetail.step = {
      stepId: 'preFloorplan',
      order: 0,
      name: 'preFloorplan',
      state: 'succeeded',
    }
    preFloorplanDetail.artifacts.push({
      artifactId: 'geometry-prefloorplan',
      availability: 'available',
      kind: 'layout_geometry',
      name: 'gcd_preFloorplan',
      stepId: 'preFloorplan',
    })
    testState.dashboard = {
      currentStep: ref('preFloorplan'),
      data: ref(snapshotStepDashboardData(preFloorplanDetail)),
      error: ref(null),
      loadTimingCorner: vi.fn(),
      loading: ref(false),
      refresh: vi.fn(),
      timingDetailErrors: ref({}),
      timingDetailLoading: ref([]),
    }

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

    const placeMacrosButton = wrapper.get('[aria-label="Place Macros"]')
    await placeMacrosButton.trigger('click')

    expect(testState.chipViewerOpen).toHaveBeenCalledWith({
      mode: 'edit',
      projectPath: '/project/ws-a',
      step: 'preFloorplan',
    })
  })

  it('keeps STA report rows from overlapping long names and paths', () => {
    expect(dashboardSource).toMatch(
      /\.reports-card\.is-sta-report-card \.report-copy strong\s*{[^}]*-webkit-line-clamp:\s*2/s,
    )
    expect(dashboardSource).toMatch(
      /\.reports-card\.is-sta-report-card \.report-copy small\s*{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s,
    )
  })
})
