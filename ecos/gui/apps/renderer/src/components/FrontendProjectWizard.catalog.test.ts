import { describe, expect, it } from 'vitest'
import wizardSource from './FrontendProjectWizard.vue?raw'

describe('FrontendProjectWizard catalog ownership', () => {
  it('does not embed CPU or SoC catalog entries in the renderer fallback state', () => {
    expect(wizardSource).not.toContain('fallbackCatalog')
    expect(wizardSource).not.toContain("id: 'darkriscv'")
    expect(wizardSource).not.toContain("id: 'vexriscv'")
    expect(wizardSource).not.toContain("id: 'cva6'")
    expect(wizardSource).not.toContain("id: 'ysyx-am-soc'")
  })
})
