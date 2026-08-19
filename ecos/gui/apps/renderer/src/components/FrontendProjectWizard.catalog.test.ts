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

  it('renders CPU IO and address contracts with a custom CPU fallback for stale catalogs', () => {
    expect(wizardSource).not.toContain('CPU_TOP_PORT_DECLARATIONS')
    expect(wizardSource).toContain('CUSTOM_CPU_TOP_PORT_CONTRACT')
    expect(wizardSource).toContain('YSYX_BLACKBOX_CPU_PORT_CONTRACT')
    expect(wizardSource).toContain('required_cpu_top_port_contract')
    expect(wizardSource).toContain('required_cpu_reset_vector')
    expect(wizardSource).toContain('soc_bootloader_payload_link_base')
  })

  it('keeps the custom cpu_top contract discoverable from the CPU choice', () => {
    expect(wizardSource).toContain("CUSTOM_FILELIST_ID = 'custom-filelist'")
    expect(wizardSource).toContain('selectedCoreId === CUSTOM_FILELIST_ID')
    expect(wizardSource).toContain(
      "LEGACY_STANDARD_CPU_FILELIST_ID = 'standard-cpu-filelist'",
    )
    expect(wizardSource).toContain('core.id !== LEGACY_STANDARD_CPU_FILELIST_ID')
    expect(wizardSource).toContain("name: 'My CPU Top'")
    expect(wizardSource).toContain('id="cpu-top-io-contract"')
    expect(wizardSource).toContain('scrollToCpuTopContract()')
    expect(wizardSource).toContain('cpuTopContractScrollPending = true')
    expect(wizardSource).toContain('watch(showCpuTopContract')
    expect(wizardSource).toContain(
      "target.scrollIntoView({ behavior: 'smooth', block: 'center'",
    )
    expect(wizardSource).toContain(
      'requestAnimationFrame(() => requestAnimationFrame(() => resolve()))',
    )
    expect(wizardSource).toContain(
      'container.scrollTop + targetRect.top - containerRect.top - 12',
    )
    expect(wizardSource).toContain('CPU Top Module')
    expect(wizardSource).toContain('config.parameters.cpu_top_module')
    expect(wizardSource).toContain('configuredCpuTopModule.value')
    expect(wizardSource).toContain('selectedCoreId.value === CUSTOM_FILELIST_ID')
    expect(wizardSource).toContain('YSYX BlackBox interface shown below')
  })

  it('supports filelist and direct RTL selection without exposing the generated filelist', () => {
    expect(wizardSource).toContain("type CpuSourceMode = 'filelist' | 'files'")
    expect(wizardSource).toContain('Use filelist')
    expect(wizardSource).toContain('Select RTL files')
    expect(wizardSource).toContain('multiple: true')
    expect(wizardSource).toContain("extensions: ['v', 'sv', 'vh', 'svh']")
    expect(wizardSource).toContain('selectedCpuRtlFiles')
    expect(wizardSource).toContain('Confirm selection')
    expect(wizardSource).toContain('cpu_rtl_files:')
    expect(wizardSource).toContain('const cpuInputReady = computed')
    expect(wizardSource).toContain('selectedCpuRtlFiles.value.length > 0')
    expect(wizardSource).toContain('cpuInputReady.value')
    expect(wizardSource).not.toContain('cpuSelectionConfirmed')
    expect(wizardSource).not.toContain('.cpu_sources.f')
  })
})
