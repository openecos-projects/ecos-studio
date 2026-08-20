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

function validCatalog() {
  return {
    version: 1,
    defaults: {
      core_id: 'cpu',
      soc_harness_id: 'soc',
      toolchain_id: 'toolchain',
      test_suite_id: 'tests',
    },
    cores: [catalogEntry('cpu')],
    soc_harnesses: [catalogEntry('soc')],
    toolchains: [catalogEntry('toolchain')],
    test_suites: [catalogEntry('tests')],
    compatibility: [
      {
        core_id: 'cpu',
        soc_harness_id: 'soc',
        can_create_workspace: true,
        support_level: 'supported',
        status: 'ready',
        summary: 'Ready',
        supported_test_suites: ['tests'],
        issues: [],
        requires_cpu_filelist: false,
      },
    ],
  }
}

function catalogEntry(id: string) {
  return {
    id,
    name: id,
    description: `${id} description`,
    status: 'stable',
  }
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

  it('accepts the supported frontend catalog schema from the desktop runtime', async () => {
    const catalog = vi.fn(async () => ({
      ...validCatalog(),
      message: ['frontend catalog list loaded'],
      response: 'success',
    }))
    setWindow({ ecosDesktop: { runtime: { frontend: { catalog } } } })

    const { listFrontendCatalogApi } = await import('./frontendCatalog')
    await expect(listFrontendCatalogApi()).resolves.toMatchObject({
      data: {
        version: 1,
        defaults: { core_id: 'cpu' },
        cores: [{ id: 'cpu' }],
      },
      message: ['frontend catalog list loaded'],
      response: 'success',
    })
  })

  it('rejects unsupported frontend catalog versions', async () => {
    setWindow({
      ecosDesktop: {
        runtime: {
          frontend: {
            catalog: async () => ({ ...validCatalog(), version: 2 }),
          },
        },
      },
    })

    const { listFrontendCatalogApi } = await import('./frontendCatalog')
    await expect(listFrontendCatalogApi()).rejects.toThrow(
      'Invalid frontend catalog: unsupported version 2; expected 1.',
    )
  })

  it.each([
    {
      label: 'a malformed catalog collection',
      mutate: (catalog: ReturnType<typeof validCatalog>) => {
        const malformed = catalog as unknown as { cores: unknown }
        malformed.cores = { id: 'cpu' }
      },
      message: 'Invalid frontend catalog: cores must be an array.',
    },
    {
      label: 'an unknown default resource id',
      mutate: (catalog: ReturnType<typeof validCatalog>) => {
        catalog.defaults.core_id = 'missing'
      },
      message:
        'Invalid frontend catalog: defaults.core_id references unknown id missing.',
    },
    {
      label: 'an invalid compatibility reference',
      mutate: (catalog: ReturnType<typeof validCatalog>) => {
        catalog.compatibility[0].supported_test_suites = ['missing']
      },
      message:
        'Invalid frontend catalog: compatibility[0].supported_test_suites references unknown id missing.',
    },
  ])('rejects $label', async ({ mutate, message }) => {
    const payload = validCatalog()
    mutate(payload)
    setWindow({
      ecosDesktop: { runtime: { frontend: { catalog: async () => payload } } },
    })

    const { listFrontendCatalogApi } = await import('./frontendCatalog')
    await expect(listFrontendCatalogApi()).rejects.toThrow(message)
  })
})
