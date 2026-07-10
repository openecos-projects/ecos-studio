import { describe, expect, it } from 'vitest'
import source from './ProjectQorTrendPanel.vue?raw'

describe('ProjectQorTrendPanel', () => {
  it('renders first-version QoR trend sections and future-work labels', () => {
    expect(source).toContain('QoR Trend')
    expect(source).toContain('Overall Score')
    expect(source).toContain('Top Regressions')
    expect(source).toContain('Missing Analysis')
    expect(source).toContain('待后续开发')
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
    expect(source).toContain('workspaceId')
    expect(source).toContain('step')
  })
})
