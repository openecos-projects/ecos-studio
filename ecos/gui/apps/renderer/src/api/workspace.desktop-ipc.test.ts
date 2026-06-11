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

describe('createWorkspaceApi desktop bridge payload', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('sends a structured-cloneable request when wizard config is reactive', async () => {
    const execute = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return {
        cmd: 'create_workspace',
        data: { directory: '/workspace/demo' },
        message: ['ok'],
        ok: true,
        response: 'success',
      }
    })

    setWindow({
      ecosDesktop: {
        cli: {
          cancel: vi.fn(),
          execute,
        },
      },
    })

    const { createWorkspaceApi } = await import('./workspace')
    const options = reactive({
      directory: '/workspace/demo',
      filelist: '',
      origin_def: '',
      origin_verilog: '/rtl/top.v',
      parameters: {
        clock: 'clk',
        core_utilization: 0.5,
        design: 'demo',
        frequency_max: 100,
        max_fanout: 20,
        target_density: 0.6,
        top_module: 'top',
      },
      pdk: 'ics55',
      pdk_root: '/pdks/ics55',
      rtl_list: ['/rtl/top.v'],
    })

    await expect(createWorkspaceApi(options)).resolves.toMatchObject({
      response: 'success',
    })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      cmd: 'create_workspace',
      data: expect.objectContaining({
        parameters: expect.objectContaining({
          design: 'demo',
        }),
        rtl_list: ['/rtl/top.v'],
      }),
    }))
  })
})
