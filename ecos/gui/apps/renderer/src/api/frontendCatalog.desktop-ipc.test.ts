import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
    return
  }

  delete (globalThis as { window?: unknown }).window
}

describe('frontend catalog desktop bridge', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('sends structured-cloneable RTL files when wizard config is reactive', async () => {
    const validateConfig = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return {
        issues: [],
        normalized: { cpu_rtl_files: ['/rtl/cpu_top.sv'] },
        ok: true,
        support_level: 'supported',
        summary: 'Supported configuration',
      }
    })

    setWindow({
      ecosDesktop: {
        runtime: {
          frontend: {
            validateConfig,
          },
        },
      },
    })

    const { validateFrontendConfigApi } = await import('./frontendCatalog')
    const config = reactive({
      core_id: 'custom-filelist',
      cpu_rtl_files: ['/rtl/cpu_top.sv'],
      cpu_top_module: 'ysyx_00000000',
      soc_harness_id: 'ysyx-am-soc',
      test_suite_id: 'cpu-tests',
      toolchain_id: 'riscv32-unknown-elf',
    })

    await expect(validateFrontendConfigApi(config)).resolves.toMatchObject({
      data: { ok: true },
      response: 'success',
    })
    expect(validateConfig).toHaveBeenCalledWith({
      core_id: 'custom-filelist',
      cpu_rtl_files: ['/rtl/cpu_top.sv'],
      cpu_top_module: 'ysyx_00000000',
      soc_harness_id: 'ysyx-am-soc',
      test_suite_id: 'cpu-tests',
      toolchain_id: 'riscv32-unknown-elf',
    })
  })
})
