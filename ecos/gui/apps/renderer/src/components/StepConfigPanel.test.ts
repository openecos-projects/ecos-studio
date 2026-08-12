import { describe, expect, it } from 'vitest'
import componentSource from './StepConfigPanel.vue?raw'

describe('StepConfigPanel', () => {
  it('accepts an explicit flow step for a route-independent editor', () => {
    expect(componentSource).toContain('step?: StepEnum')
    expect(componentSource).toContain("useStepConfigInfo(toRef(props, 'step'))")
  })

  it('uses N/A when the current step has no configuration file', () => {
    expect(componentSource).toContain('v-else-if="isEmpty"')
    expect(componentSource).toContain('>N/A</p>')
    expect(componentSource).not.toContain('No configuration data')
  })
})
