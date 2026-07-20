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
    expect(source).toContain('analysis.hotspots')
    expect(source).toContain('analysis.integrityIssues')
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
    expect(source).toContain("return 'PVT / RC corner'")
    expect(source).not.toContain('process_corner')
  })
})
