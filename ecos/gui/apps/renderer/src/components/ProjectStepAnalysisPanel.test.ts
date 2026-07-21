import { describe, expect, it } from 'vitest'
import source from './ProjectStepAnalysisPanel.vue?raw'

describe('ProjectStepAnalysisPanel', () => {
  it('uses the current dark project-management workbench layout', () => {
    expect(source).toContain('class="stage-workbench"')
    expect(source).toContain('class="stage-rail"')
    expect(source).toContain('class="stage-main"')
    expect(source).toContain('class="findings-rail"')
    expect(source).toContain('Project Step Analysis')
    expect(source).toContain('var(--bg-secondary)')
    expect(source).toContain('border-radius: 8px')
  })

  it('renders V3 metrics, bounded registered details, and V3 findings only', () => {
    expect(source).toContain('selectedStage.value?.metrics')
    expect(source).toContain(
      'selectedWorkspace.value?.analysis.steps[props.selectedStep]?.details',
    )
    expect(source).toContain('place_map_summary')
    expect(source).toContain('cts_clock_skew_table')
    expect(source).toContain('layer_table')
    expect(source).toContain('rule_layer_table')
    expect(source).toContain('rcx_spef_corner_table')
    expect(source).toContain('path_group_table')
    expect(source).toContain('analysis.blockingIssues')
    expect(source).toContain('analysis.hardGateFailures')
    expect(source).toContain('analysis.missingMetrics')
    expect(source).toContain('analysis.hotspots')
    expect(source).toContain('analysis.integrityIssues')
    expect(source).toContain('analysis.timingIssues')
    expect(source).toContain('analysis.timingCoverage')
    expect(source).not.toContain('readOptionalProjectTextFile')
    expect(source).not.toContain('feature/')
    expect(source).not.toContain('report/')
  })

  it('shows signoff coverage and full STA PVT/RC labels without inventing RCX PVT data', () => {
    expect(source).toContain('stageCoverage')
    expect(source).toContain('selectedSignoffStatus')
    expect(source).toContain('signoff {{ selectedSignoffStatus }}')
    expect(source).toContain("path_group_table: 'records'")
    expect(source).toContain(
      "path_group_table: ['corner_context', 'path_group', 'setup', 'hold']",
    )
    expect(source).toContain("corner_context: 'PVT / RC corner'")
    expect(source).not.toContain('process_corner')
  })

  it('adapts the current bounded V3 detail summaries without feature reads', () => {
    expect(source).toContain('clock_count: summary.clock_count')
    expect(source).toContain('top_5_percent_average: row.top_5_percent_average')
    expect(source).toContain("dr_wirelength: recordValue(row.dr, 'wirelength')")
    expect(source).toContain("la_overflow: recordValue(row.la, 'overflow')")
    expect(source).toContain("? 'No DRC violations.'")
    expect(source).toContain("'Worst skew [ns]'")
    expect(source).toContain("'DR wirelength'")
  })

  it('labels the comparison surface as step-specific key metrics', () => {
    expect(source).toContain('step key metrics')
    expect(source).toContain('No step-specific V3 metrics are available for this stage.')
  })

  it('uses metrics as rows and workspaces as columns with finding detail info', () => {
    expect(source).toContain("'--workspace-count': String(workspaceMetricColumns.length)")
    expect(source).toContain('v-for="workspace in workspaceMetricColumns"')
    expect(source).toContain('v-for="row in metricWorkspaceRows"')
    expect(source).toContain('class="finding-detail-info"')
    expect(source).toContain('Detail info')
    expect(source).toContain('Actual: {{ findingValueLabel(finding) }}')
    expect(source).toContain('Required metric unavailable')
    expect(source).toContain('Required signoff gate')
    expect(source).toContain('Failed hard gate')
    expect(source).toContain('analysis/sta_timing_issues.json')
  })

  it('keeps stage regions stable and gives every list an independent scroll area', () => {
    expect(source).toContain('class="stage-rail-list"')
    expect(source).toContain(
      'grid-template-rows: 64px minmax(0, 1.06fr) minmax(0, 0.94fr)',
    )
    expect(source).toContain('grid-template-rows: 28px minmax(0, 1fr)')
    expect(source).toContain('No bounded detail data is available for this stage.')
    expect(source).toContain('.stage-rail-list')
    expect(source).toContain('.stage-metric-table')
    expect(source).toContain('.stage-detail-list')
    expect(source).toContain('.findings-rail ul')
    expect(source).toContain('overflow-y: auto')
    expect(source).toContain('scrollbar-gutter: stable')
  })

  it('uses fixed-size items in every repeated Flow Stage list', () => {
    expect(source).toContain('.stage-rail-item')
    expect(source).toContain('height: 40px')
    expect(source).toContain('.stage-metric-heading,')
    expect(source).toContain('.stage-detail-view')
    expect(source).toContain('height: 176px')
    expect(source).toContain('th,')
    expect(source).toContain('height: 32px')
    expect(source).toContain('.findings-rail li')
    expect(source).toContain('height: 108px')
    expect(source).toContain('.finding-detail-info[open]')
  })
})
