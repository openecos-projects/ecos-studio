import { describe, expect, it } from 'vitest'
import componentSource from './StepConfigPanel.vue?raw'

describe('StepConfigPanel', () => {
  it('accepts an explicit flow step for a route-independent editor', () => {
    expect(componentSource).toContain('step?: StepEnum')
    expect(componentSource).toContain("useStepConfigInfo(toRef(props, 'step'))")
    expect(componentSource).toContain('tool?: string')
    expect(componentSource).toContain('formatStepToolName(props.tool)')
    expect(componentSource).toContain('stepHeading')
  })

  it('uses N/A when the current step has no configuration file', () => {
    expect(componentSource).toContain('v-else-if="isEmpty"')
    expect(componentSource).toContain('>N/A</p>')
    expect(componentSource).not.toContain('No configuration data')
  })

  it('renders a read-only baseline comparison column when a baseline workspace exists', () => {
    expect(componentSource).toContain('useBaselineStepConfig(currentStep)')
    expect(componentSource).toContain('sc-compare-col--baseline')
    expect(componentSource).toContain('Baseline ·')
    expect(componentSource).toContain('read-only')
    expect(componentSource).toContain('provide(stepConfigDiffKey')
    expect(componentSource).toContain('computeStepConfigDiff')
    expect(componentSource).toContain('diffCount')
    expect(componentSource).toContain('sc-diff-badge')
  })

  it('never writes baseline data: save/reset act only on the current workspace draft', () => {
    expect(componentSource).toContain('await saveStepConfig()')
    expect(componentSource).not.toContain('saveStepConfig(baseline')
    expect(componentSource).toContain('baseline.viewDraft.value')
    // Baseline column renders the dynamic view in readonly mode only
    expect(componentSource).toMatch(
      /v-model="baseline\.viewDraft\.value"[\s\S]*?readonly/,
    )
  })

  it('refreshes both sides on reload and keeps the baseline column toggleable', () => {
    expect(componentSource).toContain(
      'await Promise.all([reloadStepConfigFiles(), baseline.refresh(true)])',
    )
    expect(componentSource).toContain('showBaseline = !showBaseline')
    expect(componentSource).toContain(':disabled="!baselineComparable"')
  })
})
