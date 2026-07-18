import { describe, expect, it } from 'vitest'
import source from './StepQorAnalysisPanel.vue?raw'

describe('StepQorAnalysisPanel', () => {
  it('renders detailed workspace views for Route, Place, and STA', () => {
    expect(source).toContain('Route layer QoR analysis')
    expect(source).toContain('Place map QoR analysis')
    expect(source).toContain('STA path group summary')
    expect(source).toContain('STA corner path group records')
    expect(source).toContain('Final DR iteration')
    expect(source).toContain('Path groups')
    expect(source).toContain('Corner records')
    expect(source).toContain('Metric overview')
    expect(source).toContain('missingMetrics')
  })

  it('keeps analysis data in the workspace inspector rather than project comparison UI', () => {
    expect(source).toContain('useStepQorAnalysis')
    expect(source).not.toContain('ProjectQorTrendPanel')
    expect(source).not.toContain('feature/')
    expect(source).not.toContain('output/')
  })
})
