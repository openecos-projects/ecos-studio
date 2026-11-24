// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStepDetail } from '@ecos-studio/shared'

const testState = vi.hoisted(() => ({
  dashboard: null as Record<string, unknown> | null,
  openReport: vi.fn(),
  chipViewerOpen: vi.fn(),
  beginChipViewerOpening: vi.fn(),
  openingStatusHandle: {
    complete: vi.fn(),
    finish: vi.fn(),
    update: vi.fn(),
  },
  showToast: vi.fn(),
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
  useWorkspace: () => ({
    currentProject: ref({ path: '/project/ws-a' }),
    showToast: testState.showToast,
  }),
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({ chipViewer: { open: testState.chipViewerOpen } }),
}))
vi.mock('@/composables/chipViewerOpeningStatus', () => ({
  beginChipViewerOpening: testState.beginChipViewerOpening,
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
          category: 'area_cost',
          direction: 'lower_is_better',
          scope: 'workspace',
          corner: null,
          analysis_group: 'placement',
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
    testState.chipViewerOpen.mockResolvedValue({})
    testState.beginChipViewerOpening.mockReset()
    testState.beginChipViewerOpening.mockReturnValue(testState.openingStatusHandle)
    testState.openingStatusHandle.complete.mockReset()
    testState.openingStatusHandle.finish.mockReset()
    testState.openingStatusHandle.update.mockReset()
    testState.showToast.mockReset()
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

  it('shows launch status while the native viewer startup request is pending', async () => {
    let resolveOpen: ((result: object) => void) | undefined
    testState.chipViewerOpen.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve
        }),
    )
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
        },
      },
    })

    await wrapper.get('[aria-label="Open Chip Viewer"]').trigger('click')

    expect(testState.beginChipViewerOpening).toHaveBeenCalledWith(
      'Opening saved Chip Viewer layout...',
      'place',
    )
    expect(testState.openingStatusHandle.finish).not.toHaveBeenCalled()
    resolveOpen?.({})
    await flushPromises()
    expect(testState.openingStatusHandle.complete).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('keeps scrollable data highlights aligned to the top', () => {
    expect(dashboardSource).toMatch(/\.data-highlights\s*{[^}]*align-content: start/s)
  })

  it.each(['pre_floorplan', 'macro_placement'])(
    'opens the macro placement edit session from %s geometry',
    async (step) => {
      const layoutDetail = detail()
      layoutDetail.step = {
        stepId: step,
        order: 0,
        name: step,
        state: 'succeeded',
      }
      layoutDetail.artifacts.push({
        artifactId: `geometry-${step}`,
        availability: 'available',
        kind: 'layout_geometry',
        name: `gcd_${step}`,
        stepId: step,
      })
      testState.dashboard = {
        currentStep: ref(step),
        data: ref(snapshotStepDashboardData(layoutDetail)),
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
          },
        },
      })

      const placeMacrosButton = wrapper.get('[aria-label="Place Macros"]')
      await placeMacrosButton.trigger('click')

      expect(testState.chipViewerOpen).toHaveBeenCalledWith({
        mode: 'edit',
        projectPath: '/project/ws-a',
        step,
      })
    },
  )

  it('warns when macro staging falls back to move-only mode', async () => {
    const preFloorplanDetail = detail()
    preFloorplanDetail.step = {
      stepId: 'pre_floorplan',
      order: 0,
      name: 'pre_floorplan',
      state: 'succeeded',
    }
    preFloorplanDetail.artifacts.push({
      artifactId: 'geometry-prefloorplan',
      availability: 'available',
      kind: 'layout_geometry',
      name: 'gcd_preFloorplan',
      stepId: 'pre_floorplan',
    })
    testState.dashboard = {
      currentStep: ref('pre_floorplan'),
      data: ref(snapshotStepDashboardData(preFloorplanDetail)),
      error: ref(null),
      loadTimingCorner: vi.fn(),
      loading: ref(false),
      refresh: vi.fn(),
      timingDetailErrors: ref({}),
      timingDetailLoading: ref([]),
    }
    testState.chipViewerOpen.mockResolvedValue({
      macroStaging: {
        enabled: false,
        warning: 'DEF parsing failed; move-only mode is active.',
      },
    })

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
        },
      },
    })

    await wrapper.get('[aria-label="Place Macros"]').trigger('click')

    expect(testState.showToast).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Macro placement staging unavailable',
      detail: 'DEF parsing failed; move-only mode is active.',
      life: 8000,
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
