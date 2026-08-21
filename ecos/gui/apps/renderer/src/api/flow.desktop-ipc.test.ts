import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { CMDEnum, InfoEnum, StepEnum } from './type'

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

describe('flow API desktop bridge payloads', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('sends structured-cloneable requests when flow command data is reactive', async () => {
    const run = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return { rerun: true }
    })
    const runStep = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return { state: 'Success', step: StepEnum.PLACEMENT }
    })
    const info = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return { id: InfoEnum.layout, info: {}, step: StepEnum.ROUTING }
    })
    const refreshConfig = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return { directory: '/work/demo', refreshed: true }
    })
    const syncConfig = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return {
        configPath: '/work/demo/config/route_ecc.json',
        directory: '/work/demo',
        parametersChanged: true,
        refreshed: true,
      }
    })

    setWindow({
      ecosDesktop: {
        runtime: {
          flow: {
            run,
            runStep,
          },
          workspace: {
            info,
            refreshConfig,
            syncConfig,
          },
        },
      },
    })

    const { getInfoApi, refreshConfigApi, rtl2gdsApi, runStepApi, syncConfigApi } =
      await import('./flow')

    await runStepApi(
      reactive({
        cmd: CMDEnum.run_step,
        data: {
          directory: '/work/demo',
          rerun: false,
          step: StepEnum.PLACEMENT,
          workspaceHandle: 'workspace-handle-1',
        },
      }),
    )
    await rtl2gdsApi(
      reactive({
        cmd: CMDEnum.rtl2gds,
        data: {
          directory: '/work/demo',
          rerun: true,
          workspaceHandle: 'workspace-handle-1',
        },
      }),
    )
    await getInfoApi(
      reactive({
        cmd: CMDEnum.get_info,
        data: {
          id: InfoEnum.layout,
          step: StepEnum.ROUTING,
          workspaceHandle: 'workspace-handle-1',
        },
      }),
    )
    await refreshConfigApi(
      reactive({
        cmd: CMDEnum.refresh_config,
        data: {
          directory: '/work/demo',
          workspaceHandle: 'workspace-handle-1',
        },
      }),
    )
    await syncConfigApi(
      reactive({
        cmd: CMDEnum.sync_config,
        data: {
          config_path: '/work/demo/config/route_ecc.json',
          directory: '/work/demo',
          workspaceHandle: 'workspace-handle-1',
        },
      }),
    )

    expect(runStep).toHaveBeenCalledWith({
      designTool: 'backend',
      options: {},
      rerun: false,
      step: StepEnum.PLACEMENT,
      workspaceHandle: 'workspace-handle-1',
    })
    expect(run).toHaveBeenCalledWith({
      designTool: 'backend',
      rerun: true,
      workspaceHandle: 'workspace-handle-1',
    })
    expect(info).toHaveBeenCalledWith({
      designTool: 'backend',
      id: InfoEnum.layout,
      step: StepEnum.ROUTING,
      workspaceHandle: 'workspace-handle-1',
    })
    expect(refreshConfig).toHaveBeenCalledWith({
      designTool: 'backend',
      workspaceHandle: 'workspace-handle-1',
    })
    expect(syncConfig).toHaveBeenCalledWith({
      configPath: '/work/demo/config/route_ecc.json',
      designTool: 'backend',
      workspaceHandle: 'workspace-handle-1',
    })
  })

  it('rejects runtime requests that only provide a workspace directory', async () => {
    const run = vi.fn()
    setWindow({
      ecosDesktop: {
        runtime: {
          flow: { run },
        },
      },
    })
    const { rtl2gdsApi } = await import('./flow')

    expect(() =>
      rtl2gdsApi({
        cmd: CMDEnum.rtl2gds,
        data: {
          designTool: 'frontend',
          directory: '/work/frontend-demo',
          rerun: false,
        },
      }),
    ).toThrow('Workspace session handle is required')
    expect(run).not.toHaveBeenCalled()
  })
})
