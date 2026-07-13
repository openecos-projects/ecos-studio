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

  it('renders CPU IO and address contracts from catalog data', () => {
    expect(wizardSource).not.toContain('CPU_TOP_PORT_DECLARATIONS')
    expect(wizardSource).not.toContain('io_master_aw_bits_awaddr')
    expect(wizardSource).toContain('required_cpu_top_port_contract')
    expect(wizardSource).toContain('required_cpu_reset_vector')
    expect(wizardSource).toContain('soc_bootloader_payload_link_base')
  })

  it('keeps the custom cpu_top contract discoverable from the CPU choice', () => {
    expect(wizardSource).toContain("selectedCoreId === 'custom-filelist'")
    expect(wizardSource).toContain('scrollToCpuTopContract()')
    expect(wizardSource).toContain('fixed ECOS SoC instantiates it directly')
  })
})
