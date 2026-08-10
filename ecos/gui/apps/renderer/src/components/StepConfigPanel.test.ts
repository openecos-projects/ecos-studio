import { describe, expect, it } from 'vitest'
import componentSource from './StepConfigPanel.vue?raw'

describe('StepConfigPanel', () => {
  it('uses N/A when the current step has no configuration file', () => {
    expect(componentSource).toContain('v-else-if="isEmpty"')
    expect(componentSource).toContain('>N/A</p>')
    expect(componentSource).not.toContain('No configuration data')
  })
})
