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
        productCommands: {
          execute: create,
        },
      },
    })

    const { backendWorkspaceOptions, createWorkspaceApi } = await import('./workspace')
    const config = reactive({
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
      pdk_requirement: {
        familyId: 'ics55',
        manualConfig: null,
        version: null,
      },
      rtl_list: ['/rtl/top.v'],
      sdc: '/constraints/top.sdc',
      flow_config: {
        start_step: 'Synthesis',
        end_step: 'Harden',
        steps: ['Synthesis', 'RCX', 'sta', 'Harden'],
      },
    })

    await expect(
      createWorkspaceApi(backendWorkspaceOptions(config, config.directory)),
    ).resolves.toMatchObject({
      response: 'success',
      data: {
        workspace_handle: 'workspace-handle-1',
      },
    })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'workspace.create',
        payload: expect.objectContaining({
          targetDirectory: '/workspace/demo',
          workspaceBindings: expect.objectContaining({
            inputs: {
              'rtl-1': '/rtl/top.v',
              sdc: '/constraints/top.sdc',
            },
          }),
          workspaceSpec: expect.objectContaining({
            design: expect.objectContaining({ name: 'demo', topModule: 'top' }),
            flow: {
              flowId: 'harden',
              fromStepId: 'Synthesis',
              throughStepId: 'Harden',
            },
            parameters: expect.objectContaining({
              'design.frequency_mhz': 100,
            }),
          }),
        }),
      }),
    )
  })

  it('keeps a synthesis-only Flow range when endpoints are inferred', async () => {
    const { backendWorkspaceOptions } = await import('./workspace')
    const options = backendWorkspaceOptions(
      {
        directory: '/workspace/synth',
        flow_config: { start_step: '', end_step: '', steps: ['Synthesis'] },
        origin_def: '',
        origin_verilog: '/rtl/top.v',
        parameters: { design: 'demo', top_module: 'top' },
        pdk: 'ics55',
        pdk_root: '/pdks/ics55',
        rtl_list: [],
      },
      '/workspace/synth',
    )

    expect(options.workspaceSpec).toMatchObject({
      design: { clockPort: 'clk' },
      flow: {
        flowId: 'syn_sta',
        fromStepId: 'Synthesis',
        throughStepId: 'Synthesis',
      },
    })
  })

  it('forwards the CPU module independently from the frontend SoC top', async () => {
    const create = vi.fn(async () => ({
      directory: '/workspace/frontend-demo',
      workspaceHandle: 'workspace-frontend-1',
    }))
    setWindow({
      ecosDesktop: {
        runtime: {
          workspace: {
            create,
          },
        },
      },
    })

    const { createWorkspaceApi } = await import('./workspace')
    await createWorkspaceApi({
      cpu_top_module: 'ysyx_00000000',
      designTool: 'frontend',
      directory: '/workspace/frontend-demo',
      parameters: {
        'Top module': 'ecos_sim_top',
        cpu_top_module: 'ysyx_00000000',
      },
    })

    expect(create).toHaveBeenCalledWith({
      designTool: 'frontend',
      payload: expect.objectContaining({
        cpu_top_module: 'ysyx_00000000',
        parameters: {
          'Top module': 'ecos_sim_top',
          cpu_top_module: 'ysyx_00000000',
        },
      }),
    })
  })

  it('forwards workspace close requests with the GUI handle', async () => {
    const close = vi.fn(async () => ({ ok: true }))
    setWindow({
      ecosDesktop: {
        runtime: {
          workspace: {
            close,
          },
        },
      },
    })

    const { closeWorkspaceApi } = await import('./workspace')

    await expect(closeWorkspaceApi('workspace-handle-1')).resolves.toEqual({ ok: true })
    expect(close).toHaveBeenCalledWith({
      designTool: 'backend',
      workspaceHandle: 'workspace-handle-1',
    })
  })
})
