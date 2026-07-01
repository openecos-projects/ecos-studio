import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStepInfoRequest } from '@ecos-studio/shared'

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

describe('workspace resource API desktop bridge payloads', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('delegates workspace resource calls to the desktop bridge', async () => {
    const index = {
      root: '/workspace/demo',
      design: 'demo',
      topModule: 'top',
      pdk: 'ics55',
      home: {
        homeJson: { path: '/workspace/demo/.home.json', exists: true, kind: 'home' },
        flowJson: {
          path: '/workspace/demo/workspace.flow.json',
          exists: true,
          kind: 'flow',
        },
        parametersJson: {
          path: '/workspace/demo/parameters.json',
          exists: true,
          kind: 'parameters',
        },
        checklistJson: {
          path: '/workspace/demo/checklist.json',
          exists: false,
          kind: 'checklist',
        },
      },
      homeData: { design: 'demo' },
      parameters: { clock: 'clk' },
      flow: { steps: [] },
      status: 'available',
      messages: [],
    }
    const home = { design: 'demo' }
    const flow = { steps: [] }
    const parameters = { clock: 'clk' }
    const stepInfo = {
      step: 'placement',
      id: 'metrics',
      response: 'available',
      info: { area: 42 },
      missing: [],
      message: [],
    }
    const request: WorkspaceStepInfoRequest = { step: 'placement', id: 'metrics' }
    const getIndex = vi.fn(async () => index)
    const readHome = vi.fn(async () => home)
    const readFlow = vi.fn(async () => flow)
    const readParameters = vi.fn(async () => parameters)
    const resolveStepInfo = vi.fn(async () => stepInfo)

    setWindow({
      ecosDesktop: {
        workspaceResources: {
          getIndex,
          readHome,
          readFlow,
          readParameters,
          resolveStepInfo,
        },
      },
    })

    const {
      getWorkspaceResourceIndexApi,
      readWorkspaceFlowResourceApi,
      readWorkspaceHomeResourceApi,
      readWorkspaceParametersResourceApi,
      resolveWorkspaceStepInfoApi,
    } = await import('./workspaceResources')

    await expect(getWorkspaceResourceIndexApi()).resolves.toBe(index)
    await expect(readWorkspaceHomeResourceApi()).resolves.toBe(home)
    await expect(readWorkspaceFlowResourceApi()).resolves.toBe(flow)
    await expect(readWorkspaceParametersResourceApi()).resolves.toBe(parameters)
    await expect(resolveWorkspaceStepInfoApi(request)).resolves.toBe(stepInfo)

    expect(getIndex).toHaveBeenCalledTimes(1)
    expect(getIndex).toHaveBeenCalledWith()
    expect(readHome).toHaveBeenCalledTimes(1)
    expect(readHome).toHaveBeenCalledWith()
    expect(readFlow).toHaveBeenCalledTimes(1)
    expect(readFlow).toHaveBeenCalledWith()
    expect(readParameters).toHaveBeenCalledTimes(1)
    expect(readParameters).toHaveBeenCalledWith()
    expect(resolveStepInfo).toHaveBeenCalledTimes(1)
    expect(resolveStepInfo).toHaveBeenCalledWith(request)
  })
})
