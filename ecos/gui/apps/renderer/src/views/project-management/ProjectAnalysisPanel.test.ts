// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProjectAnalysisPanel from './ProjectAnalysisPanel.vue'
import {
  dashboardSummaryFixture,
  projectFixture,
  workspaceFixture,
} from './projectDashboard.fixture'
import {
  evidenceFixture,
  stepSnapshotFixture,
  trendSummaryFixture,
  workspaceSummaryFixture,
} from '@/components/projectStepAnalysis.fixture'
import type { ProjectManagementProject } from '@/utils/projectManagement'

function mountPanel(project: ProjectManagementProject = projectFixture()) {
  return mount(ProjectAnalysisPanel, {
    props: {
      project,
      selectedAnalysisTab: 'dashboard' as const,
      selectedStep: 'Route' as const,
      selectedWorkspaceId: 'ws_b',
    },
    global: {
      stubs: {
        ProjectStepAnalysisPanel: true,
        ProjectQorScoreChart: true,
      },
    },
  })
}

function rowFor(wrapper: ReturnType<typeof mountPanel>, workspaceId: string) {
  return wrapper
    .findAll('.dash-compare-row:not(.is-head)')
    .find((row) => row.find('.dash-workspace-id').text() === workspaceId)
}

describe('ProjectAnalysisPanel dashboard health', () => {
  it('renders flow progress as workspaces complete, with the steps left as detail', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.dash-progress-headline strong').text()).toBe('2/3')
    const detail = wrapper.find('.dash-progress-headline small').text()
    expect(detail).toContain('workspaces completed every step')
    expect(detail).toContain('4 of 12 steps left')
  })

  it('renders one run-state bar segment per state, sized by percent', () => {
    const segments = mountPanel().findAll('.dash-runbar i')

    expect(segments).toHaveLength(2)
    expect(segments[0].attributes('style')).toContain('width: 66.7%')
    expect(segments[0].classes()).toContain('run-state-success')
    expect(segments[1].classes()).toContain('run-state-failed')
  })

  it('renders the readiness checks with their coverage tone', () => {
    const checks = mountPanel().findAll('.dash-checks li')

    expect(checks.map((check) => check.find('strong').text())).toEqual([
      '2/3',
      '1/3',
      '3/3',
    ])
    expect(checks[2].classes()).toContain('tone-good')
  })

  it('moves the label gloss into a tooltip and keeps only data notes inline', () => {
    const checks = mountPanel().findAll('.dash-checks li')

    expect(checks[0].attributes('title')).toBe('Workspaces reporting zero DRC violations')
    expect(checks.map((check) => check.find('small').exists())).toEqual([
      false,
      true,
      false,
    ])
  })

  it('leaves per-workspace failure detail to the workspace tree', () => {
    expect(mountPanel().find('.dash-blockers').exists()).toBe(false)
  })
})

describe('ProjectAnalysisPanel baseline controls', () => {
  it('shows the active baseline', () => {
    expect(mountPanel().find('.dash-baseline-chip strong').text()).toBe('ws_a')
  })

  it('requires confirmation before emitting a baseline change', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.dash-actions .dash-btn').trigger('click')

    expect(wrapper.emitted('set-baseline')).toBeUndefined()
    expect(wrapper.find('.dash-baseline-confirm').text()).toContain(
      'Make ws_b the baseline?',
    )

    await wrapper.find('.dash-baseline-confirm .dash-btn.primary').trigger('click')

    expect(wrapper.emitted('set-baseline')).toEqual([[{ workspaceId: 'ws_b' }]])
  })

  it('drops the pending baseline change when cancelled', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.dash-actions .dash-btn').trigger('click')
    await wrapper.findAll('.dash-baseline-confirm .dash-btn')[1].trigger('click')

    expect(wrapper.emitted('set-baseline')).toBeUndefined()
    expect(wrapper.find('.dash-baseline-confirm').exists()).toBe(false)
  })

  it('disables the baseline button when the selection is already the baseline', () => {
    const wrapper = mount(ProjectAnalysisPanel, {
      props: {
        project: projectFixture(),
        selectedAnalysisTab: 'dashboard' as const,
        selectedStep: 'Route' as const,
        selectedWorkspaceId: 'ws_a',
      },
      global: {
        stubs: { ProjectStepAnalysisPanel: true, ProjectQorScoreChart: true },
      },
    })

    expect(wrapper.find('.dash-actions .dash-btn').attributes('disabled')).toBeDefined()
  })

  it('keeps the action row compact without an export report control', () => {
    const actions = mountPanel().find('.dash-actions')

    expect(actions.text()).not.toContain('Export report')
    expect(actions.findAll('.dash-btn')).toHaveLength(1)
  })
})

describe('ProjectAnalysisPanel recommendation', () => {
  it('names the QoR best workspace with its score and threshold standing', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.dash-recommend-id').text()).toBe('ws_b')
    expect(wrapper.find('.dash-recommend-headline strong').text()).toContain('74.2')
    expect(wrapper.find('.dash-recommend-note').text()).toBe(
      'Meets the 60 analysis threshold',
    )
  })

  it('hides the reason line when it only restates the score', () => {
    expect(mountPanel().find('.dash-recommend-reason').exists()).toBe(false)
  })

  it('shows a reason that adds something beyond the score', () => {
    const project = projectFixture()
    const wrapper = mountPanel({
      ...project,
      comparisonSummary: {
        ...project.comparisonSummary,
        bestReason: 'Only workspace with a complete run',
      },
    })

    expect(wrapper.find('.dash-recommend-reason').text()).toBe(
      'Only workspace with a complete run',
    )
  })

  it('lists the PPA metrics of the recommended workspace as label and value pairs', () => {
    const metrics = mountPanel().findAll('.dash-recommend-metrics div')

    expect(metrics.map((entry) => entry.find('dt').text())).toEqual([
      'Frequency [MHz]',
      'WNS',
      'DRC',
      'LVS',
      'Die Area',
      'Core Util',
    ])
    expect(metrics[0].find('dd').text()).toBe('150 MHz')
    // The full name stays reachable when the label is ellipsized.
    expect(metrics[0].find('dt').attributes('title')).toBe('Frequency [MHz]')
  })

  it('selects the recommended workspace when its id is clicked', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.dash-recommend-id').trigger('click')

    expect(wrapper.emitted('select-workspace')).toEqual([['ws_b']])
  })

  it('falls back to an empty state when no workspace is rated', () => {
    const project = projectFixture({ bestWorkspaceId: 'ws_missing' })
    const wrapper = mountPanel(project)

    expect(wrapper.find('.dash-recommend').classes()).toContain('is-empty')
    expect(wrapper.find('.dash-recommend-reason').text()).toContain('No workspace')
  })
})

describe('ProjectAnalysisPanel workspace comparison', () => {
  it('renders one row per workspace with progress, score, and signoff', () => {
    const wrapper = mountPanel()
    const rows = wrapper.findAll('.dash-compare-row:not(.is-head)')

    expect(rows).toHaveLength(3)
    const first = rowFor(wrapper, 'ws_a')
    expect(first?.find('.dash-progress-value').text()).toBe('2/4')
    expect(first?.find('.is-score').text()).toBe('58.4')
    expect(first?.find('.is-signoff').text()).toBe('Ready')
  })

  it('badges the recommended and baseline workspaces', () => {
    const wrapper = mountPanel()

    expect(rowFor(wrapper, 'ws_a')?.find('.dash-badge.is-baseline').exists()).toBe(true)
    expect(rowFor(wrapper, 'ws_b')?.find('.dash-badge.is-best').exists()).toBe(true)
    expect(rowFor(wrapper, 'ws_c')?.find('.dash-badge').exists()).toBe(false)
  })

  it('marks the selected workspace row', () => {
    const wrapper = mountPanel()

    expect(rowFor(wrapper, 'ws_b')?.attributes('aria-selected')).toBe('true')
    expect(rowFor(wrapper, 'ws_a')?.attributes('aria-selected')).toBe('false')
  })

  it('does not present a workspace with no analysis artifacts as clean', () => {
    expect(
      rowFor(mountPanel(), 'ws_c')?.find('.dash-issue-count.is-neutral').text(),
    ).toBe('not assessed')
  })

  it('reports findings as blocking over total rather than by invented severity', () => {
    const project = projectFixture()
    const wrapper = mountPanel({
      ...project,
      workspaceSummaries: [
        workspaceSummaryFixture('ws_a', {
          Route: stepSnapshotFixture({
            hotspotArtifactStatus: 'missing',
            blockingIssues: [
              {
                step: 'Route',
                metric: 'route_drc_count',
                displayName: 'Routing DRC violations',
                value: 12,
                reason: 'DRC violations remain.',
                evidence: evidenceFixture(),
              },
            ],
          }),
        }),
        ...project.workspaceSummaries.slice(1),
      ],
    })

    const cell = rowFor(wrapper, 'ws_a')?.find('.dash-compare-cell.is-issues')
    expect(cell?.text()).toBe('1/2')
    expect(cell?.find('.dash-issue-count').classes()).toContain('is-critical')
    expect(cell?.attributes('title')).toContain('listed as blocking')
  })

  it('selects a workspace when its row header is clicked', async () => {
    const wrapper = mountPanel()

    await rowFor(wrapper, 'ws_a')?.find('.dash-cell-action').trigger('click')

    expect(wrapper.emitted('select-workspace')).toEqual([['ws_a']])
  })

  it('sorts rows when a column header is activated, and reverses on a second click', async () => {
    const wrapper = mountPanel()
    const scoreHeader = wrapper.findAll('.dash-compare-head')[2]

    await scoreHeader.find('.dash-sort-action').trigger('click')
    expect(
      wrapper
        .findAll('.dash-compare-row:not(.is-head) .dash-workspace-id')
        .map((cell) => cell.text()),
    ).toEqual(['ws_b', 'ws_a', 'ws_c'])
    expect(scoreHeader.attributes('aria-sort')).toBe('descending')

    await scoreHeader.find('.dash-sort-action').trigger('click')
    expect(
      wrapper
        .findAll('.dash-compare-row:not(.is-head) .dash-workspace-id')
        .map((cell) => cell.text()),
    ).toEqual(['ws_a', 'ws_b', 'ws_c'])
    expect(scoreHeader.attributes('aria-sort')).toBe('ascending')
  })

  it('exposes the comparison as a semantic grid', () => {
    const wrapper = mountPanel()
    const grid = wrapper.find('.dash-compare-table')

    expect(grid.attributes('role')).toBe('grid')
    expect(grid.attributes('aria-rowcount')).toBe('4')
    // Five fixed columns, eight metric columns (runtime and memory are appended), one action.
    expect(grid.attributes('aria-colcount')).toBe('14')
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(14)
    expect(rowFor(wrapper, 'ws_a')?.find('[role="rowheader"]').exists()).toBe(true)
  })

  it('virtualizes large workspace sets and narrows the rendered rows with search', async () => {
    const workspaceIds = [
      'ws_b',
      ...Array.from({ length: 29 }, (_, index) => `ws_${index}`),
    ]
    const project = projectFixture({
      workspaces: workspaceIds.map((workspaceId) => workspaceFixture(workspaceId)),
      workspaceSummaries: workspaceIds.map((workspaceId) =>
        workspaceSummaryFixture(workspaceId, {}),
      ),
      qorTrendSummary: trendSummaryFixture(
        workspaceIds.map((workspaceId) => ({ workspaceId })),
        'ws_0',
      ),
      bestWorkspaceId: 'ws_b',
      comparisonSummary: {
        bestWorkspaceId: 'ws_b',
        bestReason: '',
        riskLabels: [],
        parameterDiffs: [],
        metricDiffs: [],
      },
      dashboardSummary: dashboardSummaryFixture({ workspaceCount: workspaceIds.length }),
    })
    const wrapper = mountPanel(project)
    const grid = wrapper.get('.dash-compare-table')

    expect(grid.attributes('aria-rowcount')).toBe('31')
    expect(wrapper.findAll('.dash-compare-row:not(.is-head)')).toHaveLength(20)

    await wrapper.get('.dash-workspace-search input').setValue('ws_28')

    expect(grid.attributes('aria-rowcount')).toBe('2')
    expect(
      wrapper
        .findAll('.dash-compare-row:not(.is-head) .dash-workspace-id')
        .map((cell) => cell.text()),
    ).toEqual(['ws_28'])
  })
})

describe('ProjectAnalysisPanel needs attention', () => {
  it('lists project-wide findings ordered by severity', () => {
    const items = mountPanel().findAll('.dash-attention-list li')

    expect(items).toHaveLength(3)
    expect(items[0].classes()).toContain('severity-critical')
    expect(items[0].find('.dash-attention-origin').text()).toContain('ws_b / STA')
    expect(items[0].find('.dash-attention-title').text()).toBe('Setup WNS')
  })

  it('summarizes the finding counts in the section header', () => {
    const wrapper = mountPanel()
    const header = wrapper.findAll('.dash-section-head small')[1]

    // Three findings, but only two carry a severity the artifacts reported.
    expect(header.text()).toContain('3 project-wide')
    expect(header.text()).toContain('1 critical · 1 warning reported')
  })

  it('marks an unrated finding with its kind instead of an invented severity', () => {
    const items = mountPanel().findAll('.dash-attention-list li')
    const regression = items[items.length - 1]

    expect(regression.classes()).toContain('severity-unreported')
    expect(regression.find('.dash-attention-severity').text()).toBe('REGR')
  })

  it('does not call incomplete analysis coverage an all-clear state', () => {
    const project = projectFixture()
    const wrapper = mountPanel(
      projectFixture({
        qorTrendSummary: { ...project.qorTrendSummary, risks: [], regressions: [] },
      }),
    )

    expect(wrapper.find('.dash-attention-list').exists()).toBe(false)
    expect(wrapper.find('.dash-attention-empty').text()).toContain(
      'Analysis coverage is incomplete',
    )
  })
})

describe('ProjectAnalysisPanel drill-down into Step Analysis', () => {
  it('switches workspace, tab, and step when a finding is opened', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.dash-attention-action').trigger('click')

    expect(wrapper.emitted('select-workspace')).toEqual([['ws_b']])
    expect(wrapper.emitted('select-analysis-tab')).toEqual([['step']])
    expect(wrapper.emitted('select-step')).toEqual([['STA']])
    expect(wrapper.emitted('select-issue-metric')).toEqual([['setup_wns']])
  })

  it('leaves the step alone for findings that do not name one', async () => {
    const wrapper = mountPanel()
    const regression = wrapper
      .findAll('.dash-attention-action')
      .find((item) => item.find('.dash-attention-title').text() === 'Die area')

    await regression?.trigger('click')

    expect(wrapper.emitted('select-analysis-tab')).toEqual([['step']])
    expect(wrapper.emitted('select-step')).toBeUndefined()
    expect(wrapper.emitted('select-issue-metric')).toEqual([[null]])
  })

  it('opens Step Analysis from a comparison row debug button', async () => {
    const wrapper = mountPanel()

    await rowFor(wrapper, 'ws_a')?.find('.dash-drill-action').trigger('click')

    expect(wrapper.emitted('select-workspace')).toEqual([['ws_a']])
    expect(wrapper.emitted('select-analysis-tab')).toEqual([['step']])
  })

  it('opens Step Analysis from the recommendation card', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.dash-recommend-action').trigger('click')

    expect(wrapper.emitted('select-workspace')).toEqual([['ws_b']])
    expect(wrapper.emitted('select-analysis-tab')).toEqual([['step']])
  })
})

describe('ProjectAnalysisPanel shell', () => {
  it('keeps both tab panels mounted so switching does not rebuild them', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('#analysis-dashboard-panel').exists()).toBe(true)
    expect(wrapper.find('#analysis-step-panel').exists()).toBe(true)
  })

  it('renders the empty state instead of the tabs when there are no workspaces', () => {
    const wrapper = mountPanel(projectFixture({ workspaces: [] }))

    expect(wrapper.find('#analysis-dashboard-panel').exists()).toBe(false)
    expect(wrapper.find('.metrics-empty-state').exists()).toBe(true)
  })

  it('moves between tabs with the arrow keys', async () => {
    const wrapper = mountPanel()

    await wrapper.find('#analysis-tab-dashboard').trigger('keydown', {
      key: 'ArrowRight',
    })

    expect(wrapper.emitted('select-analysis-tab')).toEqual([['step']])
  })
})
