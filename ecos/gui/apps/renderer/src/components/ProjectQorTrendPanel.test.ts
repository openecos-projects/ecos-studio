import { describe, expect, it } from 'vitest'
import source from './ProjectQorTrendPanel.vue?raw'

describe('ProjectQorTrendPanel', () => {
  it('renders first-version QoR trend sections and future-work labels', () => {
    expect(source).toContain('QoR Trend')
    expect(source).toContain('Overall Score')
    expect(source).toContain('Top Regressions')
    expect(source).toContain('Missing Analysis')
    expect(source).toContain('待后续开发')
    expect(source).toContain('missingAnalysisSteps')
    expect(source).toContain('missingMetrics')
    expect(source).toContain('Blocking Issues')
    expect(source).toContain('blockingIssues')
    expect(source).toContain('Hotspots')
    expect(source).toContain('hotspots')
    expect(source).toContain('Baseline:')
    expect(source).toContain('baselineLabel')
    expect(source).toContain('baselineWorkspaceId')
    expect(source).toContain('ri-download-line')
    expect(source).toContain("'export-report'")
    expect(source).toContain('ri-flag-line')
    expect(source).toContain("'set-baseline'")
    expect(source).toContain('setSelectedWorkspaceAsBaseline')
    expect(source).toContain('qor-missing-block')
    expect(source).toContain('unsupportedModules')
  })

  it('uses prepared QoR model data instead of reading project files directly', () => {
    expect(source).toContain('qorTrendSummary')
    expect(source).not.toContain('readOptionalProjectTextFile')
    expect(source).not.toContain('feature/')
    expect(source).not.toContain('output/')
  })

  it('emits workspace and step selection from trend interactions', () => {
    expect(source).toContain('defineEmits')
    expect(source).toContain("'select-point'")
    expect(source).toContain('exportReport')
    expect(source).toContain('workspaceId')
    expect(source).toContain('step')
  })

  it('keeps dense QoR lists scrollable instead of truncating visible data', () => {
    expect(source).not.toContain('.slice(0, 4)')
    expect(source).toContain('qor-scroll-list')
    expect(source).toContain('class="qor-trend-points qor-scroll-list"')
    expect(source).toContain('class="qor-delta-list qor-scroll-list"')
    expect(source).toContain('class="qor-module-list qor-scroll-list"')
    expect(source).toContain('grid-template-rows:')
    expect(source).toContain('overflow: hidden;')
    expect(source).toContain('overflow: auto;')
    expect(source).toContain('min-height: 0;')
  })
})
