// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ProjectStepAnalysisPanel from './ProjectStepAnalysisPanel.vue'
import {
  compareSummaryFixture,
  evidenceFixture,
  metricRecordFixture,
  stepSnapshotFixture,
  trendSummaryFixture,
  workspaceSummaryFixture,
} from './projectStepAnalysis.fixture'
import type { ProjectWorkspaceSummary } from '@/utils/projectManagement'

function routeWorkspace(workspaceId: string, wirelength = 1000): ProjectWorkspaceSummary {
  return workspaceSummaryFixture(workspaceId, {
    Route: stepSnapshotFixture({
      summaryStatus: 'blocked',
      hotspotArtifactStatus: 'missing',
      metrics: [
        metricRecordFixture({
          metricName: 'route_drc_count',
          displayName: 'Routing DRC violations',
          value: 12,
          unit: 'count',
        }),
        metricRecordFixture({
          metricName: 'route_wirelength',
          displayName: 'Total wirelength',
          value: wirelength,
          unit: 'um',
        }),
      ],
      blockingIssues: [
        {
          step: 'Route',
          metric: 'route_drc_count',
          displayName: 'Routing DRC violations',
          value: 12,
          reason: 'DRC violations remain after detail routing.',
          evidence: evidenceFixture({
            sourceFile: 'analysis/qor_summary.json',
            sourceSelector: 'gates[0]',
            expectedOperator: '<=',
            expectedValue: 0,
            diagnosis: 'Detail routing left 12 shorts on M3.',
          }),
        },
      ],
    }),
  })
}

function mountPanel(overrides: Record<string, unknown> = {}) {
  // ws_b is the baseline and routes 100 um longer, so the panel has a real delta to show.
  const workspaceSummaries = [routeWorkspace('ws_a'), routeWorkspace('ws_b', 1100)]
  return mount(ProjectStepAnalysisPanel, {
    props: {
      steps: [compareSummaryFixture('Route'), compareSummaryFixture('DRC')],
      workspaceSummaries,
      qorTrendSummary: trendSummaryFixture(
        [{ workspaceId: 'ws_a' }, { workspaceId: 'ws_b' }],
        'ws_b',
      ),
      projectName: 'demo',
      projectObjective: 'QoR comparison',
      bestWorkspaceId: 'ws_b',
      selectedStep: 'Route' as const,
      selectedWorkspaceId: 'ws_a',
      ...overrides,
    },
  })
}

/** An STA timing path: the artifact reports a severity and an evidence selector. */
function mountStaPanel() {
  return mountPanel({
    steps: [compareSummaryFixture('STA')],
    selectedStep: 'STA' as const,
    workspaceSummaries: [
      workspaceSummaryFixture('ws_a', {
        STA: stepSnapshotFixture({
          step: 'STA',
          timingIssues: [
            {
              issueId: 'setup_0',
              workspaceId: 'ws_a',
              workspaceName: 'ws_a',
              severity: 'critical',
              analysisType: 'setup',
              corner: 'ss_0p72v_125c',
              pathGroup: 'clk',
              checkType: 'max',
              slackNs: -0.42,
              launchClockNetworkDelayNs: 1.2,
              captureClockNetworkDelayNs: 1.35,
              clockNetworkDelayDeltaNs: 0.15,
            },
          ],
        }),
      }),
    ],
  })
}

/** Comparison is the second reading of a step, so a test has to ask for it. */
async function openCompare(wrapper: ReturnType<typeof mountPanel>) {
  await wrapper.findAll('.mode-tab')[1].trigger('click')
  return wrapper
}

describe('ProjectStepAnalysisPanel', () => {
  it('badges every flow step with the selected workspace issue count and switches step', async () => {
    const wrapper = mountPanel()

    const rail = wrapper.findAll('.step-rail-item')
    expect(rail).toHaveLength(2)
    expect(rail[0].text()).toContain('Route')
    expect(rail[0].find('.step-rail-mark').classes()).toContain('bad')
    expect(rail[1].find('.step-rail-mark').classes()).toContain('none')

    await rail[1].trigger('click')
    expect(wrapper.emitted('select-step')).toEqual([['DRC']])
  })

  it('leads with a verdict for the selected workspace and step', () => {
    const wrapper = mountPanel()

    const badge = wrapper.get('.verdict-badge')
    expect(badge.text()).toBe('Blocked')
    expect(wrapper.get('.verdict-summary').text()).toBe(
      '2 findings · 1 listed as blocking',
    )
    expect(wrapper.get('.verdict').text()).toContain('2/3')
  })

  it('shows no verdict badge when the artifact reported no status', () => {
    const workspace = workspaceSummaryFixture('ws_a', {
      Route: stepSnapshotFixture({ summaryStatus: null }),
    })
    const wrapper = mountPanel({ workspaceSummaries: [workspace] })

    expect(wrapper.find('.verdict-badge').exists()).toBe(false)
    expect(wrapper.get('.verdict').text()).toContain('Artifacts')
  })

  it('auto-selects the first queued issue and shows all evidence without expanding anything', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('details').exists()).toBe(false)

    const card = wrapper.get('.evidence-card')
    expect(card.classes()).toContain('blocking')
    expect(wrapper.get('.issue-item.selected .issue-title').text()).toBe(
      'Routing DRC violations',
    )

    const facts = card.get('.evidence-facts').text()
    expect(facts).toContain('12 count')
    expect(facts).toContain('0 count')
    expect(facts).toContain('route_drc_count <= 0 count')
    expect(facts).toContain('analysis/qor_summary.json#gates[0]')
    expect(facts).toContain('Detail routing left 12 shorts on M3.')
  })

  it('leads the evidence card with the finding channel, not a severity word', () => {
    const header = mountPanel().get('.evidence-card > header')

    expect(header.get('.evidence-kind').text()).toBe('Blocking issue')
    // The title is the bold line of the selected queue row, so the card does not repeat it.
    expect(header.text()).not.toContain('Routing DRC violations')
    // qor_summary.json lists the finding as blocking but reports no severity for it.
    expect(header.get('.evidence-flag').text()).toBe('blocking')
    expect(header.find('.evidence-severity').exists()).toBe(false)
  })

  it('trails the metric id on the source path instead of giving it its own slot', () => {
    const facts = mountPanel().get('.evidence-facts')

    expect(facts.text()).not.toContain('Metric')
    expect(facts.get('.evidence-metric-id').text()).toBe('route_drc_count')
    expect(facts.text()).toContain('analysis/qor_summary.json#gates[0]')
  })

  it('drops the metric id when the evidence path already names it', () => {
    // The selector spells out issue_id=setup_0, which is also the metric id.
    const facts = mountStaPanel().get('.evidence-facts')

    expect(facts.text()).toContain('analysis/sta_timing_issues.json#issue_id=setup_0')
    expect(facts.find('.evidence-metric-id').exists()).toBe(false)
  })

  it('quotes a severity only for the channels that report one', () => {
    const header = mountStaPanel().get('.evidence-card > header')

    expect(header.get('.evidence-severity').text()).toBe('critical')
    expect(header.find('.evidence-flag').exists()).toBe(false)
  })

  it('omits the threshold rows for findings whose artifact reports none', () => {
    const facts = mountStaPanel().get('.evidence-facts').text()

    expect(facts).not.toContain('Expected')
    expect(facts).not.toContain('Pass condition')
    // The diagnosis still carries what the artifact did report about the path.
    expect(facts).toContain('clock-delay delta 0.15 ns')
  })

  it('renders no evidence card for channels whose artifact adds nothing past the row', async () => {
    const wrapper = mountPanel()

    await wrapper.findAll('.issue-item')[1].trigger('click')

    expect(wrapper.find('.evidence-card').exists()).toBe(false)
    expect(wrapper.find('.pane-empty').exists()).toBe(false)
    // The artifact path stays reachable on the row itself.
    expect(wrapper.findAll('.issue-item')[1].attributes('title')).toContain(
      'analysis/qor_hotspots.json',
    )
  })

  it('highlights the metric row that the selected issue points at', () => {
    const wrapper = mountPanel()

    const highlighted = wrapper.findAll('.metric-row.highlighted')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].text()).toContain('Routing DRC violations')
  })

  it('narrows the queue by finding channel and retargets the evidence pane', async () => {
    const wrapper = mountPanel()
    expect(wrapper.findAll('.issue-item')).toHaveLength(2)

    expect(
      wrapper.findAll('.severity-filters button').map((button) => button.text()),
    ).toEqual(['All 2', 'Blocking issue 1', 'Artifact 1'])

    const artifactFilter = wrapper
      .findAll('.severity-filters button')
      .find((button) => button.text().startsWith('Artifact'))
    await artifactFilter?.trigger('click')

    const issues = wrapper.findAll('.issue-item')
    expect(issues).toHaveLength(1)
    expect(issues[0].classes()).toContain('selected')
    expect(issues[0].classes()).not.toContain('blocking')
  })

  it('resets a stale issue filter when the selected step changes', async () => {
    const wrapper = mountPanel()
    const artifactFilter = wrapper
      .findAll('.severity-filters button')
      .find((button) => button.text().startsWith('Artifact'))

    await artifactFilter?.trigger('click')
    await wrapper.setProps({ selectedStep: 'DRC' as const })

    const filters = wrapper.findAll('.severity-filters button')
    expect(filters).toHaveLength(1)
    expect(filters[0].classes()).toContain('selected')
    expect(wrapper.get('.issue-pane .pane-empty').text()).toContain(
      'No findings reported',
    )
    expect(wrapper.get('.evidence-pane > .pane-empty').text()).toContain(
      'No findings reported',
    )
  })

  it('selects the requested issue metric when Dashboard supplies one', () => {
    const wrapper = mountPanel({ selectedIssueMetric: 'analysis/qor_hotspots.json' })

    expect(wrapper.get('.issue-item.selected .issue-title').text()).toBe(
      'QoR hotspots artifact',
    )
  })

  it('switches the evidence card when another issue is picked', async () => {
    const wrapper = mountStaPanel()
    expect(wrapper.get('.evidence-card').text()).toContain('ss_0p72v_125c')

    await wrapper.findAll('.severity-filters button')[0].trigger('click')

    expect(wrapper.get('.issue-item').classes()).toContain('selected')
    expect(wrapper.findAll('.metric-row.highlighted')).toHaveLength(0)
  })

  it('offers workspace switching with per-workspace issue counts', async () => {
    const wrapper = mountPanel()

    const selector = wrapper.get('.workspace-selector')
    expect(selector.text()).toContain('ws_a')
    expect(selector.get('.chip-count').text()).toBe('2')
    expect(selector.get('.chip-count').classes()).toContain('bad')

    await selector.trigger('click')

    const options = wrapper.findAll('.workspace-picker-option')
    expect(options).toHaveLength(2)
    expect(options[0].classes()).toContain('selected')
    expect(options[1].text()).toContain('base')
    expect(options[1].text()).toContain('best')

    await options[1].trigger('click')
    expect(wrapper.emitted('select-workspace')).toEqual([['ws_b']])
  })

  it('keeps a large workspace picker compact and makes every workspace searchable', async () => {
    const workspaceIds = Array.from(
      { length: 50 },
      (_, index) => `ws_${String(index + 1).padStart(4, '0')}`,
    )
    const wrapper = mountPanel({
      workspaceSummaries: workspaceIds.map((workspaceId, index) =>
        routeWorkspace(workspaceId, 1000 + index),
      ),
      qorTrendSummary: trendSummaryFixture(
        workspaceIds.map((workspaceId) => ({ workspaceId })),
        'ws_0001',
      ),
      bestWorkspaceId: 'ws_0002',
      selectedWorkspaceId: 'ws_0050',
    })

    expect(wrapper.get('.workspace-picker-total').text()).toBe('50 workspaces')
    expect(wrapper.get('.workspace-selector').text()).toContain('ws_0050')
    expect(wrapper.find('.workspace-picker-popover').exists()).toBe(false)

    await wrapper.get('.workspace-selector').trigger('click')
    expect(wrapper.findAll('.workspace-picker-option')).toHaveLength(16)

    await wrapper.get('.workspace-picker-search input').setValue('ws_0049')
    const matched = wrapper.findAll('.workspace-picker-option')
    expect(matched).toHaveLength(1)
    expect(matched[0].text()).toContain('ws_0049')

    await matched[0].trigger('click')
    expect(wrapper.emitted('select-workspace')).toEqual([['ws_0049']])
    expect(wrapper.find('.workspace-picker-popover').exists()).toBe(false)
  })

  it('opens on the findings of one workspace and switches to the comparison on request', async () => {
    const wrapper = mountPanel()

    const tabs = wrapper.findAll('.mode-tab')
    expect(tabs.map((tab) => tab.text())).toEqual(['Findings 2', 'Compare 1'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.step-body').exists()).toBe(true)
    expect(wrapper.find('.compare-view').exists()).toBe(false)

    await tabs[1].trigger('click')

    expect(tabs[1].attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.step-body').exists()).toBe(false)
    const compare = wrapper.get('.compare-view')
    expect(compare.findAll('.compare-head')).toHaveLength(2)
    expect(compare.get('.compare-group').text()).toBe('Routability')

    // Both metrics the workspaces reported get a row, not just a curated key metric.
    expect(compare.findAll('.compare-metric').map((row) => row.text())).toEqual([
      'Routing DRC violationscount / lower is better',
      'Total wirelengthum / lower is better',
    ])
  })

  it('says how many metrics differ from the baseline before any row is read', async () => {
    const wrapper = await openCompare(mountPanel())

    expect(wrapper.get('.compare-caption').text()).toBe('baseline ws_b · 1 of 2 differ')
  })

  it('reports no difference rather than an empty caption when the rows all match', async () => {
    const wrapper = await openCompare(
      mountPanel({
        workspaceSummaries: [routeWorkspace('ws_a'), routeWorkspace('ws_b')],
      }),
    )

    expect(wrapper.get('.compare-caption').text()).toBe(
      'baseline ws_b · no metric differs',
    )
  })

  it('leads with the selected workspace outcome without adding a card for every column', async () => {
    const wrapper = await openCompare(mountPanel())

    expect(wrapper.findAll('.verdict-card')).toHaveLength(1)
    const card = wrapper.get('.verdict-card')
    expect(card.get('.verdict-card-summary').text()).toBe('1 better · 0 worse · 1 same')
    // Half the comparable metrics improved and half held, so the bar splits in two.
    const segments = card.findAll('.win-bar i')
    expect(segments.map((segment) => segment.classes())).toEqual([['good'], ['neutral']])
    expect(segments.map((segment) => segment.attributes('style'))).toEqual([
      'width: 50%;',
      'width: 50%;',
    ])

    await wrapper.setProps({ selectedWorkspaceId: 'ws_b' })
    const baselineCard = wrapper.get('.verdict-card')
    expect(baselineCard.get('.verdict-card-summary').text()).toBe(
      'Baseline for this step',
    )
    expect(baselineCard.find('.win-bar').exists()).toBe(false)
  })

  it('leads with the baseline column so a scrolled comparison keeps its reference', async () => {
    const wrapper = await openCompare(mountPanel())

    // ws_b is the baseline and ws_a the current workspace, whatever order the project
    // lists them in, and only the baseline column is frozen beside the metric column.
    expect(wrapper.findAll('.compare-head-name').map((head) => head.text())).toEqual([
      'ws_b',
      'ws_a',
    ])
    const heads = wrapper.findAll('.compare-head')
    expect(heads[0].classes()).toContain('pinned')
    expect(heads[1].classes()).not.toContain('pinned')
    expect(wrapper.findAll('.compare-cell')[0].classes()).toContain('pinned')
  })

  it('carries the unit, the relative change, and a bar on each compare delta', async () => {
    const wrapper = await openCompare(mountPanel())

    // Row order is DRC then wirelength, and the baseline leads each row's cells.
    const cells = wrapper.findAll('.compare-cell')
    expect(cells[3].get('strong').text()).toBe('1000 um')
    expect(cells[3].get('.compare-delta').text()).toBe('-100 um -9.1%')
    expect(cells[3].get('.compare-delta').classes()).toContain('good')
    // 9.1% of the 25% that fills a bar, drawn out of the centre toward the better side.
    const fill = cells[3].get('.delta-bar-fill').attributes('style') ?? ''
    expect(fill).toContain('left: 50%')
    expect(Number.parseFloat(fill.split('width:')[1])).toBeCloseTo(18.18, 2)
    // The baseline keeps the track so its centre line reads as the zero every bar shares.
    expect(cells[2].get('.compare-delta').text()).toBe('base')
    expect(cells[2].get('.delta-bar-fill').attributes('style')).toBe(
      'left: 50%; width: 0%;',
    )
  })

  it('marks the leading value of a row, and marks none when the values tie', async () => {
    const wrapper = await openCompare(mountPanel())

    const cells = wrapper.findAll('.compare-cell')
    // Both workspaces report 12 DRC violations, so neither of them wins the row.
    expect(cells[0].classes()).not.toContain('leads')
    expect(cells[1].classes()).not.toContain('leads')
    expect(cells[3].classes()).toContain('leads')
    expect(cells[3].get('.lead-flag').text()).toBe('best')
    expect(cells[3].get('button').attributes('title')).toBe(
      'ws_a Total wirelength: 1000 um · -100 um (-9.1%) · best reported value (um / lower is better)',
    )
  })

  it('hides the rows every workspace matched when only differences are asked for', async () => {
    const wrapper = await openCompare(mountPanel())

    const toggle = wrapper.get('.differ-toggle')
    expect(toggle.text()).toBe('Only differing 1')
    expect(wrapper.findAll('.compare-metric')).toHaveLength(2)

    await toggle.trigger('click')

    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(
      wrapper.findAll('.compare-metric').map((row) => row.get('strong').text()),
    ).toEqual(['Total wirelength'])
    expect(wrapper.get('[role="grid"]').attributes('aria-rowcount')).toBe('3')
  })

  it('offers no difference filter when it would empty the table or change nothing', async () => {
    const allMatch = await openCompare(
      mountPanel({
        workspaceSummaries: [routeWorkspace('ws_a'), routeWorkspace('ws_b')],
      }),
    )

    expect(allMatch.find('.differ-toggle').exists()).toBe(false)
  })

  it('exposes the comparison matrix as a semantic grid', async () => {
    const wrapper = await openCompare(mountPanel())

    const grid = wrapper.get('[role="grid"]')
    expect(grid.attributes('aria-colcount')).toBe('3')
    // One column header row, one dimension row, and one row per reported metric.
    expect(grid.attributes('aria-rowcount')).toBe('4')
    expect(grid.findAll('[role="row"]')).toHaveLength(4)
    expect(grid.findAll('[role="columnheader"]')).toHaveLength(3)
    expect(grid.findAll('[role="rowheader"]')).toHaveLength(3)
    expect(grid.findAll('[role="gridcell"]')).toHaveLength(4)
  })

  it('marks the cells the baseline never reported instead of leaving them blank', async () => {
    const wrapper = await openCompare(
      mountPanel({
        workspaceSummaries: [
          routeWorkspace('ws_a'),
          workspaceSummaryFixture('ws_b', {
            Route: stepSnapshotFixture({ metrics: [] }),
          }),
        ],
      }),
    )

    // The baseline column leads, and it is the one that reported nothing.
    const cells = wrapper.findAll('.compare-cell')
    expect(cells[0].get('strong').text()).toBe('Not reported')
    expect(cells[0].classes()).toContain('unreported')
    expect(cells[1].get('.compare-delta').text()).toBe('base n/a')
    // Nothing to measure against, so the cell carries no bar rather than an empty track.
    expect(cells[1].find('.delta-bar').exists()).toBe(false)
    expect(wrapper.findAll('.verdict-card-summary')[0].text()).toBe(
      'No metric of this step can be compared with the baseline',
    )
  })

  it('renders N/A for a failed step and keeps not-reported for a successful step', async () => {
    const wrapper = await openCompare(
      mountPanel({
        workspaceSummaries: [
          routeWorkspace('ws_a'),
          workspaceSummaryFixture('ws_b', {
            Route: stepSnapshotFixture({ flowStatus: 'failed', metrics: [] }),
          }),
        ],
      }),
    )

    const failedCell = wrapper.findAll('.compare-cell')[0]
    expect(failedCell.get('strong').text()).toBe('N/A')
    expect(failedCell.classes()).toContain('not-applicable')
    expect(failedCell.classes()).not.toContain('unreported')
    expect(failedCell.get('button').attributes('title')).toContain(
      'Not applicable: Route failed',
    )
  })

  /** Eight workspaces, so the table is wider than any panel and every control matters. */
  function mountWideCompare(count = 8) {
    const workspaceIds = Array.from({ length: count }, (_, index) => `ws_${index}`)
    return openCompare(
      mountPanel({
        workspaceSummaries: workspaceIds.map((workspaceId, index) =>
          routeWorkspace(workspaceId, 1000 + index * 10),
        ),
        qorTrendSummary: trendSummaryFixture(
          workspaceIds.map((workspaceId) => ({ workspaceId })),
          'ws_1',
        ),
        bestWorkspaceId: 'ws_2',
        selectedWorkspaceId: 'ws_0',
      }),
    )
  }

  function columnNames(wrapper: ReturnType<typeof mountPanel>) {
    return wrapper.findAll('.compare-head-name').map((head) => head.text())
  }

  it('gives every workspace of the project a column instead of rationing them', async () => {
    const wrapper = await mountWideCompare()

    expect(columnNames(wrapper)).toEqual([
      // Baseline and current workspace lead; the rest keep the project's own order.
      'ws_1',
      'ws_0',
      'ws_2',
      'ws_3',
      'ws_4',
      'ws_5',
      'ws_6',
      'ws_7',
    ])
    expect(wrapper.get('.compare-column-count').text()).toBe('8 workspaces')
    expect(
      wrapper.findAll('.compare-column-filters button').map((button) => button.text()),
    ).toEqual(['All 8', 'Reported 8', 'Differing 7', 'Findings 8'])
  })

  it('narrows the columns by search without dropping the baseline or current workspace', async () => {
    const wrapper = await mountWideCompare()

    await wrapper.get('.compare-column-search input').setValue('ws_5')

    expect(columnNames(wrapper)).toEqual(['ws_1', 'ws_0', 'ws_5'])
    expect(wrapper.get('.compare-column-count').text()).toBe('3 of 8 workspaces')

    await wrapper.get('.scope-reset').trigger('click')
    expect(columnNames(wrapper)).toHaveLength(8)
    expect(wrapper.find('.scope-reset').exists()).toBe(false)
  })

  it('says why the reference columns survive a search that matches nothing', async () => {
    const wrapper = await mountWideCompare()

    await wrapper.get('.compare-column-search input').setValue('nothing-like-this')

    expect(columnNames(wrapper)).toEqual(['ws_1', 'ws_0'])
    expect(wrapper.get('.compare-column-count').text()).toBe(
      'no match · reference columns only',
    )
    // Narrowing further could only ever remove a reference column, so it is not on offer.
    expect(
      wrapper
        .findAll('.compare-column-filters button')
        .map((button) => button.attributes('disabled') !== undefined),
    ).toEqual([false, true, true, true])
  })

  it('ranks the columns by the metric a reader presses, then reverses and clears it', async () => {
    const wrapper = await mountWideCompare()
    // Wirelength rises with the workspace index and lower is better on this metric.
    const wirelength = () => wrapper.findAll('.compare-metric')[1]

    await wirelength().get('button').trigger('click')
    expect(wirelength().classes()).toContain('ranked')
    expect(columnNames(wrapper)).toEqual([
      'ws_1',
      'ws_0',
      'ws_2',
      'ws_3',
      'ws_4',
      'ws_5',
      'ws_6',
      'ws_7',
    ])

    await wirelength().get('button').trigger('click')
    expect(columnNames(wrapper)).toEqual([
      'ws_1',
      'ws_0',
      'ws_7',
      'ws_6',
      'ws_5',
      'ws_4',
      'ws_3',
      'ws_2',
    ])

    await wirelength().get('button').trigger('click')
    expect(wirelength().classes()).not.toContain('ranked')
    expect(columnNames(wrapper)[2]).toBe('ws_2')
  })

  // A wide comparison is narrowed by ranking and filtering, never by cells that quietly
  // drop what they report to fit more of them on screen.
  it('keeps the relative change in every cell however wide the comparison gets', async () => {
    const wrapper = await mountWideCompare(20)

    expect(wrapper.findAll('.compare-delta em').length).toBeGreaterThan(0)
  })

  it('sinks a workspace with nothing to compare, and drops it on request', async () => {
    const wrapper = await openCompare(
      mountPanel({
        workspaceSummaries: [
          workspaceSummaryFixture('ws_failed', {
            Route: stepSnapshotFixture({ flowStatus: 'failed', metrics: [] }),
          }),
          routeWorkspace('ws_a'),
          routeWorkspace('ws_b', 1100),
        ],
        qorTrendSummary: trendSummaryFixture(
          [
            { workspaceId: 'ws_failed' },
            { workspaceId: 'ws_a' },
            { workspaceId: 'ws_b' },
          ],
          'ws_b',
        ),
        selectedWorkspaceId: 'ws_a',
      }),
    )

    // The project lists it first, but a column of N/A belongs after the ones with values.
    expect(columnNames(wrapper)).toEqual(['ws_b', 'ws_a', 'ws_failed'])

    const reported = wrapper
      .findAll('.compare-column-filters button')
      .find((button) => button.text().startsWith('Reported'))
    expect(reported?.text()).toBe('Reported 2')
    await reported?.trigger('click')

    expect(columnNames(wrapper)).toEqual(['ws_b', 'ws_a'])
    expect(wrapper.get('.compare-column-count').text()).toBe('2 of 3 workspaces')
  })

  it('says a comparison is not on offer when the project has no baseline', async () => {
    const wrapper = await openCompare(
      mountPanel({
        qorTrendSummary: trendSummaryFixture(
          [{ workspaceId: 'ws_a' }, { workspaceId: 'ws_b' }],
          null,
        ),
      }),
    )

    expect(wrapper.find('.verdict-cards').exists()).toBe(false)
    expect(wrapper.get('.compare-no-baseline').text()).toBe(
      'No baseline workspace is set, so no value here can be read as better or worse.',
    )
  })

  it('explains an unanalyzed step instead of rendering an empty workbench', () => {
    const wrapper = mountPanel({ selectedStep: 'DRC' })

    expect(wrapper.get('.verdict-badge').text()).toBe('No analysis')
    expect(wrapper.get('.issue-pane').text()).toContain('No findings reported for DRC')
    expect(wrapper.find('.evidence-card').exists()).toBe(false)
    expect(wrapper.text()).toContain('No V3 metrics were reported for DRC')
  })

  it('renders DRC result and detail availability as separate facts', () => {
    const workspace = workspaceSummaryFixture('ws_a', {
      DRC: stepSnapshotFixture({
        step: 'DRC',
        metrics: [
          metricRecordFixture({
            step: 'DRC',
            metricName: 'drc_count',
            value: 0,
            unit: 'count',
          }),
        ],
      }),
    })
    const wrapper = mountPanel({
      steps: [compareSummaryFixture('DRC')],
      selectedStep: 'DRC' as const,
      workspaceSummaries: [workspace],
    })

    const detail = wrapper.get('[aria-label="DRC rules by layer"] .pane-empty-detail')
    expect(detail.text()).toContain('No rule/layer breakdown')
    expect(detail.text()).toContain('DRC count: 0 · Summary: pass')
    expect(detail.text()).not.toContain('No DRC violations')
  })

  it('marks a missing DRC metrics artifact instead of presenting its path as available', () => {
    const workspace = workspaceSummaryFixture('ws_a', {
      DRC: stepSnapshotFixture({
        step: 'DRC',
        artifactStatus: 'missing',
        summaryArtifactStatus: 'missing',
        hotspotArtifactStatus: 'missing',
        summaryStatus: null,
      }),
    })
    const wrapper = mountPanel({
      steps: [compareSummaryFixture('DRC')],
      selectedStep: 'DRC' as const,
      workspaceSummaries: [workspace],
    })

    const source = wrapper.get('[aria-label="DRC rules by layer"] .pane-header small')
    expect(source.text()).toBe('QoR metrics: missing')
    expect(source.attributes('title')).toBe('analysis/qor_metrics.json: missing')
  })
})
