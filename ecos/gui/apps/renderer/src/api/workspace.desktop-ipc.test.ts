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

describe('workspace desktop bridge', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('sends a structured-cloneable request when wizard config is reactive', async () => {
    const create = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return {
        directory: '/workspace/demo',
        workspaceHandle: 'workspace-handle-1',
      }
    })

    setWindow({
      ecosDesktop: {
        ecc: {
          workspace: {
            create,
          },
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
      flow_config: {
        start_step: 'Synthesis',
        end_step: 'Harden',
        steps: ['Synthesis', 'RCX', 'sta', 'Harden'],
      },
    })

    await expect(createWorkspaceApi(options)).resolves.toMatchObject({
      response: 'success',
      data: {
        workspace_handle: 'workspace-handle-1',
      },
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          design: 'demo',
        }),
        rtlList: ['/rtl/top.v'],
        flowConfig: {
          start_step: 'Synthesis',
          end_step: 'Harden',
          steps: ['Synthesis', 'RCX', 'sta', 'Harden'],
        },
      }),
    )
  })

  it('forwards workspace close requests with the GUI handle', async () => {
    const close = vi.fn(async () => ({ ok: true }))
    setWindow({
      ecosDesktop: {
        ecc: {
          workspace: {
            close,
          },
        },
      },
    })

    const { closeWorkspaceApi } = await import('./workspace')

    await expect(closeWorkspaceApi('workspace-handle-1')).resolves.toEqual({ ok: true })
    expect(close).toHaveBeenCalledWith({ workspaceHandle: 'workspace-handle-1' })
  })
})
