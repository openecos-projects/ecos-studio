import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const {
  currentProject,
  fetchSharedHomeData,
  invalidateWorkspaceResources,
  readProjectTextFile,
  refreshConfigApi,
  runtimeEvents,
  resourceVersions,
  writeProjectTextFile,
  resolveProjectPathAccess,
} = vi.hoisted(() => ({
  currentProject: {
    value: { path: '/workspace/demo' } as { path: string } | null,
  },
  fetchSharedHomeData: vi.fn(),
  invalidateWorkspaceResources: vi.fn((scopes: string | string[], options?: { sessionId?: string }) => {
    const lifecycle = useWorkspaceLifecycle()
    const sessionId = options?.sessionId ?? lifecycle.currentSessionId.value
    lifecycle.invalidate(scopes as never, { ...options, sessionId })
    resourceVersions.value = lifecycle.resourceVersions.value
  }),
  readProjectTextFile: vi.fn(),
  refreshConfigApi: vi.fn(),
  runtimeEvents: { value: [] },
  resourceVersions: {
    __v_isRef: true,
    value: {
      home: 0,
      flow: 0,
      parameters: 0,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      tiles: 0,
      all: 0,
    },
  },
  writeProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject,
    invalidateWorkspaceResources,
    runtimeEvents,
    resourceVersions,
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({
    isDesktopRuntimeAvailable: true,
  }),
}))

vi.mock('./useHomeData', () => ({
  fetchSharedHomeData,
  convertRemoteToLocalPath: (path: string) => path,
}))

vi.mock('@/utils/projectFiles', () => ({
  readProjectTextFile,
  writeProjectTextFile,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess,
}))

vi.mock('@/api/flow', () => ({
  refreshConfigApi,
}))

import { useParameters } from './useParameters'
import {
  clearFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
} from './useFlowRunner'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { requestHomeRunArtifactReset } from './homeRunArtifacts'

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function parametersJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    PDK: 'ics55',
    Design: 'demo',
    'Top module': 'chip_top',
    Die: { Size: [100, 100], Area: 10000 },
    Core: {
      Size: [80, 80],
      Area: 6400,
      'Bounding box': '(0,0) (80,80)',
      Utilitization: 0.5,
      Margin: [4, 4],
      'Aspect ratio': 1,
    },
    'Max fanout': 20,
    'Target density': 0.3,
    'Target overflow': 0.1,
    'Global right padding': 0,
    'Cell padding x': 600,
    'Routability opt flag': 1,
    Clock: 'clk',
    'Frequency max [MHz]': 100,
    'Bottom layer': 'MET2',
    'Top layer': 'MET5',
    'PDK Root': '/pdks/ics55',
    ...overrides,
  })
}

describe('useParameters desktop bridge integration', () => {
  beforeEach(() => {
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    lifecycle.resourceVersions.value = {
      home: 0,
      flow: 0,
      parameters: 0,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      tiles: 0,
      all: 0,
    }
    const session = lifecycle.beginSession({
      workspaceId: 'workspace-demo',
      projectRoot: '/workspace/demo',
    })
    lifecycle.activateSession(session.sessionId)
    currentProject.value = { path: '/workspace/demo' }
    runtimeEvents.value = []
    resourceVersions.value = {
      home: 0,
      flow: 0,
      parameters: 0,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      tiles: 0,
      all: 0,
    }
    fetchSharedHomeData.mockReset()
    invalidateWorkspaceResources.mockClear()
    readProjectTextFile.mockReset()
    refreshConfigApi.mockReset()
    refreshConfigApi.mockResolvedValue({
      cmd: 'refresh_config',
      data: { directory: '/workspace/demo', refreshed: true },
      message: ['refreshed'],
      response: 'success',
    })
    writeProjectTextFile.mockReset()
    resolveProjectPathAccess.mockClear()
    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  afterEach(() => {
    vi.useRealTimers()
    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  it('loads and saves parameters through the bridge-backed file helpers', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    expect(parameters.config.design).toBe('demo')
    expect(parameters.config.topModule).toBe('chip_top')

    parameters.config.design = 'updated_demo'

    await expect(parameters.saveParameters()).resolves.toBe(true)

    expect(resolveProjectPathAccess).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    expect(writeProjectTextFile).toHaveBeenCalledWith(
      '/workspace/demo/home/parameters.json',
      expect.stringContaining('"Design": "updated_demo"'),
    )
    expect(refreshConfigApi).toHaveBeenCalledWith({
      cmd: 'refresh_config',
      data: {
        directory: '/workspace/demo',
      },
    })
  })

  it('keeps displayed parameters unchanged when rerun reset is requested before parameters.json changes', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile
      .mockResolvedValueOnce(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'demo',
        'Top module': 'chip_top',
        Die: { Size: [110, 110], Area: 12100 },
        Core: {
          Size: [88, 88],
          Area: 7744,
          'Bounding box': '(0,0) (88,88)',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
        'Max fanout': 20,
        'Target density': 0.3,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk',
        'Frequency max [MHz]': 100,
        'Bottom layer': 'MET2',
        'Top layer': 'MET5',
        'PDK Root': '/pdks/ics55',
      }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    requestHomeRunArtifactReset('/workspace/demo')

    expect(parameters.config.design).toBe('demo')
    expect(parameters.config.topModule).toBe('chip_top')
    expect(parameters.config.clock).toBe('clk')
    expect(parameters.config.frequencyMax).toBe(100)
    expect(parameters.config.bottomLayer).toBe('MET2')
    expect(parameters.config.topLayer).toBe('MET5')
    expect(parameters.config.die.Size).toEqual([100, 100])
    expect(parameters.config.die.area).toBe(10000)
    expect(parameters.config.core.Size).toEqual([80, 80])
    expect(parameters.config.core.area).toBe(6400)
    expect(parameters.config.core.boundingBox).toBe('(0,0) (80,80)')
    expect(parameters.config.core.utilization).toBe(0.5)
    expect(parameters.config.core.margin).toEqual([4, 4])
    await vi.waitFor(() => {
      expect(parameters.hasChanges.value).toBe(false)
    })

    await parameters.loadParameters()

    await vi.waitFor(() => {
      expect(parameters.config.die.Size).toEqual([110, 110])
    })
    expect(parameters.config.core.Size).toEqual([88, 88])
    expect(parameters.config.core.boundingBox).toBe('(0,0) (88,88)')
    expect(parameters.hasChanges.value).toBe(false)
  })

  it('keeps the last valid parameters during transient rerun home reloads without a parameters path', async () => {
    fetchSharedHomeData
      .mockResolvedValueOnce({
        parameters: '/workspace/demo/home/parameters.json',
      })
      .mockResolvedValueOnce({
        parameters: '',
      })
      .mockResolvedValueOnce({
        parameters: '/workspace/demo/home/parameters.json',
      })
    readProjectTextFile
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'demo',
        'Top module': 'chip_top',
        Die: { Size: [100, 100], Area: 10000 },
        Core: {
          Size: [80, 80],
          Area: 6400,
          'Bounding box': '(0,0) (80,80)',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
        'Max fanout': 20,
        'Target density': 0.3,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk',
        'Frequency max [MHz]': 100,
        'Bottom layer': 'MET2',
        'Top layer': 'MET5',
        'PDK Root': '/pdks/ics55',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'demo',
        'Top module': 'chip_top',
        Die: { Size: [], Area: 0 },
        Core: {
          Size: [],
          Area: 0,
          'Bounding box': '',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
        'Max fanout': 20,
        'Target density': 0.3,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk',
        'Frequency max [MHz]': 100,
        'Bottom layer': 'MET2',
        'Top layer': 'MET5',
        'PDK Root': '/pdks/ics55',
      }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    markFlowExecutionActiveForWorkspace('/workspace/demo')
    await parameters.loadParameters()

    expect(parameters.config.design).toBe('demo')
    expect(parameters.config.topModule).toBe('chip_top')
    expect(parameters.config.clock).toBe('clk')
    expect(parameters.config.die.Size).toEqual([100, 100])
    expect(parameters.config.core.Size).toEqual([80, 80])
    expect(parameters.hasChanges.value).toBe(false)

    await parameters.loadParameters()

    expect(parameters.config.design).toBe('demo')
    expect(parameters.config.topModule).toBe('chip_top')
    expect(parameters.config.clock).toBe('clk')
    expect(parameters.config.die.Size).toEqual([])
    expect(parameters.config.core.Size).toEqual([])
    expect(parameters.hasChanges.value).toBe(false)

    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  it('reloads parameters directly from the cached file path while a flow is running', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile
      .mockResolvedValueOnce(parametersJson())
      .mockResolvedValueOnce(parametersJson({
        Die: { Size: [], Area: 0 },
        Core: {
          Size: [],
          Area: 0,
          'Bounding box': '',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
      }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })
    expect(parameters.config.die.Size).toEqual([100, 100])
    expect(fetchSharedHomeData).toHaveBeenCalledTimes(1)

    markFlowExecutionActiveForWorkspace('/workspace/demo')
    await parameters.refreshParameters()

    await vi.waitFor(() => {
      expect(parameters.config.die.Size).toEqual([])
    })

    expect(parameters.config.design).toBe('demo')
    expect(parameters.config.topModule).toBe('chip_top')
    expect(parameters.config.clock).toBe('clk')
    expect(fetchSharedHomeData).toHaveBeenCalledTimes(1)
    expect(readProjectTextFile).toHaveBeenLastCalledWith('/workspace/demo/home/parameters.json')

    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  it('does not replace config objects when a direct running-flow refresh reads unchanged parameters', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(parametersJson())

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    const dieRef = parameters.config.die
    const coreRef = parameters.config.core

    markFlowExecutionActiveForWorkspace('/workspace/demo')
    await parameters.refreshParameters()

    expect(parameters.config.die).toBe(dieRef)
    expect(parameters.config.core).toBe(coreRef)
    expect(fetchSharedHomeData).toHaveBeenCalledTimes(1)

    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  it('polls the known parameters file while a flow is running without touching shared home data', async () => {
    vi.useFakeTimers()
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile
      .mockResolvedValueOnce(parametersJson())
      .mockResolvedValueOnce(parametersJson({
        Die: { Size: [], Area: 0 },
        Core: {
          Size: [],
          Area: 0,
          'Bounding box': '',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
      }))

    const scope = effectScope()
    const parameters = scope.run(() => useParameters())!

    try {
      await vi.waitFor(() => {
        expect(parameters.config.die.Size).toEqual([100, 100])
      })
      expect(fetchSharedHomeData).toHaveBeenCalledTimes(1)

      markFlowExecutionActiveForWorkspace('/workspace/demo')
      await vi.advanceTimersByTimeAsync(1600)

      await vi.waitFor(() => {
        expect(parameters.config.die.Size).toEqual([])
      })
      expect(fetchSharedHomeData).toHaveBeenCalledTimes(1)

      clearFlowExecutionActiveForWorkspace('/workspace/demo')
      await vi.advanceTimersByTimeAsync(1600)

      expect(readProjectTextFile).toHaveBeenCalledTimes(2)
      expect(fetchSharedHomeData).toHaveBeenCalledTimes(1)
    } finally {
      scope.stop()
    }
  })

  it('rejects parameter saves while the workspace flow is running', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    parameters.config.design = 'blocked_update'
    markFlowExecutionActiveForWorkspace('/workspace/demo')

    await expect(parameters.saveParameters()).resolves.toBe(false)

    expect(writeProjectTextFile).not.toHaveBeenCalled()
    expect(parameters.error.value).toContain('Flow is running')
  })

  it('increments dependent resource versions only after a successful save', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    parameters.config.design = 'updated_demo'

    const initialVersions = { ...resourceVersions.value }

    await expect(parameters.saveParameters()).resolves.toBe(true)

    expect(resourceVersions.value.parameters).toBe(initialVersions.parameters + 1)
    expect(resourceVersions.value.home).toBe(initialVersions.home + 1)
    expect(resourceVersions.value['step-config']).toBe(initialVersions['step-config'] + 1)
    expect(resourceVersions.value.flow).toBe(initialVersions.flow + 1)
    expect(resourceVersions.value.all).toBe(initialVersions.all)
  })

  it('refreshes workspace config after saving a max fanout parameter change', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    parameters.config.maxFanout = 64

    await expect(parameters.saveParameters()).resolves.toBe(true)

    expect(writeProjectTextFile).toHaveBeenCalledWith(
      '/workspace/demo/home/parameters.json',
      expect.stringContaining('"Max fanout": 64'),
    )
    expect(refreshConfigApi).toHaveBeenCalledWith({
      cmd: 'refresh_config',
      data: {
        directory: '/workspace/demo',
      },
    })
  })

  it('does not increment home or parameters resource versions when save fails', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile.mockRejectedValue(new Error('disk full'))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    parameters.config.design = 'updated_demo'

    const initialVersions = { ...resourceVersions.value }

    await expect(parameters.saveParameters()).resolves.toBe(false)

    expect(resourceVersions.value).toEqual(initialVersions)
  })

  it('keeps written parameters as the baseline when refresh config fails after save', async () => {
    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    refreshConfigApi.mockResolvedValue({
      cmd: 'refresh_config',
      data: { directory: '/workspace/demo', refreshed: false },
      message: ['refresh failed'],
      response: 'error',
    })

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    parameters.config.design = 'updated_demo'

    await expect(parameters.saveParameters()).resolves.toBe(false)

    expect(writeProjectTextFile).toHaveBeenCalled()
    expect(parameters.hasChanges.value).toBe(false)
    expect(parameters.error.value).toBe('refresh failed')
  })

  it('does not invalidate the new workspace when an old save resolves after a session switch', async () => {
    let resolveWrite: (() => void) | undefined

    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile.mockReturnValue(new Promise<void>((resolve) => {
      resolveWrite = resolve
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    parameters.config.design = 'updated_demo'

    const savePromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    const lifecycle = useWorkspaceLifecycle()
    const nextSession = lifecycle.beginSession({
      workspaceId: 'workspace-other',
      projectRoot: '/workspace/other',
    })
    lifecycle.activateSession(nextSession.sessionId)
    currentProject.value = { path: '/workspace/other' }
    resourceVersions.value = {
      home: 10,
      flow: 0,
      parameters: 20,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      tiles: 0,
      all: 0,
    }

    resolveWrite?.()
    await expect(savePromise).resolves.toBe(true)

    expect(resourceVersions.value.home).toBe(10)
    expect(resourceVersions.value.parameters).toBe(20)
  })

  it('does not invalidate the newly selected project when currentProject changes before the reload watcher advances save guards', async () => {
    let resolveWrite: (() => void) | undefined

    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile.mockReturnValue(new Promise<void>((resolve) => {
      resolveWrite = resolve
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'updated_demo'
    const savePromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    currentProject.value = { path: '/workspace/other' }
    resourceVersions.value = {
      home: 10,
      flow: 0,
      parameters: 20,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      tiles: 0,
      all: 0,
    }

    resolveWrite?.()
    await expect(savePromise).resolves.toBe(true)

    expect(resourceVersions.value.home).toBe(10)
    expect(resourceVersions.value.parameters).toBe(20)
  })

  it('does not clear the new workspace dirty state when an old save resolves after a session switch', async () => {
    let resolveWrite: (() => void) | undefined

    fetchSharedHomeData
      .mockResolvedValueOnce({
        parameters: '/workspace/demo/home/parameters.json',
      })
      .mockResolvedValueOnce({
        parameters: '/workspace/other/home/parameters.json',
      })
    readProjectTextFile
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'demo',
        'Top module': 'chip_top',
        Die: { Size: [100, 100], Area: 10000 },
        Core: {
          Size: [80, 80],
          Area: 6400,
          'Bounding box': '(0,0) (80,80)',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
        'Max fanout': 20,
        'Target density': 0.3,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk',
        'Frequency max [MHz]': 100,
        'Bottom layer': 'MET2',
        'Top layer': 'MET5',
        'PDK Root': '/pdks/ics55',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'other',
        'Top module': 'chip_top',
        Die: { Size: [120, 120], Area: 14400 },
        Core: {
          Size: [90, 90],
          Area: 8100,
          'Bounding box': '(0,0) (90,90)',
          Utilitization: 0.6,
          Margin: [5, 5],
          'Aspect ratio': 1,
        },
        'Max fanout': 24,
        'Target density': 0.4,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk',
        'Frequency max [MHz]': 120,
        'Bottom layer': 'MET2',
        'Top layer': 'MET5',
        'PDK Root': '/pdks/ics55',
      }))
    writeProjectTextFile.mockReturnValue(new Promise<void>((resolve) => {
      resolveWrite = resolve
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'updated_demo'
    const savePromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    const lifecycle = useWorkspaceLifecycle()
    const nextSession = lifecycle.beginSession({
      workspaceId: 'workspace-other',
      projectRoot: '/workspace/other',
    })
    lifecycle.activateSession(nextSession.sessionId)
    currentProject.value = { path: '/workspace/other' }
    resourceVersions.value = {
      ...resourceVersions.value,
      parameters: resourceVersions.value.parameters + 1,
    }
    await parameters.loadParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('other')
    })
    await vi.waitFor(() => {
      expect(parameters.isSaving.value).toBe(false)
    })
    expect(parameters.error.value).toBeNull()

    parameters.config.design = 'other_dirty'
    await vi.waitFor(() => {
      expect(parameters.hasChanges.value).toBe(true)
    })

    resolveWrite?.()
    await expect(savePromise).resolves.toBe(true)

    expect(parameters.config.design).toBe('other_dirty')
    expect(parameters.hasChanges.value).toBe(true)
    expect(parameters.isSaving.value).toBe(false)
    expect(parameters.error.value).toBeNull()
  })

  it('does not let an older overlapping save in the same session clear the newer save state', async () => {
    let resolveFirstWrite: (() => void) | undefined
    let resolveSecondWrite: (() => void) | undefined

    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile
      .mockReturnValueOnce(new Promise<void>((resolve) => {
        resolveFirstWrite = resolve
      }))
      .mockReturnValueOnce(new Promise<void>((resolve) => {
        resolveSecondWrite = resolve
      }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'save_a'
    const saveAPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    parameters.config.design = 'save_b'
    await vi.waitFor(() => {
      expect(parameters.hasChanges.value).toBe(true)
    })
    const saveBPromise = parameters.saveParameters()

    const initialVersions = { ...resourceVersions.value }

    resolveFirstWrite?.()
    await expect(saveAPromise).resolves.toBe(true)

    expect(parameters.config.design).toBe('save_b')
    expect(parameters.hasChanges.value).toBe(true)
    expect(parameters.isSaving.value).toBe(true)
    expect(parameters.error.value).toBeNull()
    expect(resourceVersions.value).toEqual(initialVersions)

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(2)
    })

    resolveSecondWrite?.()
    await expect(saveBPromise).resolves.toBe(true)

    expect(parameters.config.design).toBe('save_b')
    expect(parameters.hasChanges.value).toBe(false)
    expect(parameters.isSaving.value).toBe(false)
    expect(parameters.error.value).toBeNull()
    expect(resourceVersions.value.parameters).toBe(initialVersions.parameters + 1)
    expect(resourceVersions.value.home).toBe(initialVersions.home + 1)
  })

  it('serializes overlapping saves so the latest snapshot wins on disk', async () => {
    let resolveFirstWrite: (() => void) | undefined
    let persistedContent = ''
    let inFlightWrites = 0

    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile
      .mockImplementationOnce(async (_path: string, content: string) => {
        inFlightWrites += 1
        await new Promise<void>((resolve) => {
          resolveFirstWrite = () => {
            persistedContent = content
            inFlightWrites -= 1
            resolve()
          }
        })
      })
      .mockImplementationOnce(async (_path: string, content: string) => {
        inFlightWrites += 1
        persistedContent = content
        inFlightWrites -= 1
      })

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'save_a'
    const saveAPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
      expect(inFlightWrites).toBe(1)
    })

    parameters.config.design = 'save_b'
    const saveBPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    resolveFirstWrite?.()
    await expect(saveAPromise).resolves.toBe(true)

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(2)
    })
    expect(inFlightWrites).toBe(0)

    await expect(saveBPromise).resolves.toBe(true)
    expect(persistedContent).toContain('"Design": "save_b"')
  })

  it('preserves save call ordering when an earlier save stalls before path resolution', async () => {
    const resolveFirstPath = createDeferred<string>()
    let persistedContent = ''

    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    resolveProjectPathAccess
      .mockResolvedValueOnce('/workspace/demo/home/parameters.json')
      .mockReturnValueOnce(resolveFirstPath.promise)
      .mockResolvedValueOnce('/workspace/demo/home/parameters.json')
    writeProjectTextFile.mockImplementation(async (_path: string, content: string) => {
      persistedContent = content
    })

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })
    expect(resolveProjectPathAccess).toHaveBeenCalledTimes(1)

    parameters.config.design = 'save_a'
    const saveAPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(resolveProjectPathAccess).toHaveBeenCalledTimes(2)
    })
    expect(writeProjectTextFile).toHaveBeenCalledTimes(0)

    parameters.config.design = 'save_b'
    const saveBPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(resolveProjectPathAccess).toHaveBeenCalledTimes(2)
    })
    expect(writeProjectTextFile).toHaveBeenCalledTimes(0)

    parameters.config.design = 'save_a_late'
    resolveFirstPath.resolve('/workspace/demo/home/parameters.json')
    await expect(saveAPromise).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(resolveProjectPathAccess).toHaveBeenCalledTimes(3)
      expect(writeProjectTextFile).toHaveBeenCalledTimes(2)
    })
    await expect(saveBPromise).resolves.toBe(true)

    expect(persistedContent).toContain('"Design": "save_b"')
  })

  it('keeps newer edits dirty when a single in-flight save resolves with an older snapshot', async () => {
    let resolveWrite: (() => void) | undefined

    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile.mockReturnValue(new Promise<void>((resolve) => {
      resolveWrite = resolve
    }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'save_a'
    const savePromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    parameters.config.design = 'edited_after_save_started'
    await vi.waitFor(() => {
      expect(parameters.hasChanges.value).toBe(true)
    })

    resolveWrite?.()
    await expect(savePromise).resolves.toBe(true)

    expect(parameters.config.design).toBe('edited_after_save_started')
    expect(parameters.hasChanges.value).toBe(true)
    expect(parameters.isSaving.value).toBe(false)
    expect(parameters.error.value).toBeNull()
  })

  it('ignores stale parameter reads after the workspace session changes', async () => {
    let resolveOldRead: ((content: string) => void) | undefined
    fetchSharedHomeData
      .mockResolvedValueOnce({
        parameters: '/workspace/demo/home/parameters.json',
      })
      .mockResolvedValueOnce({
        parameters: '/workspace/other/home/parameters.json',
      })
    readProjectTextFile
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveOldRead = resolve
      }))
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'current-demo',
        'Top module': 'chip_top',
        Die: { Size: [100, 100], Area: 10000 },
        Core: {
          Size: [80, 80],
          Area: 6400,
          'Bounding box': '(0,0) (80,80)',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
        'Max fanout': 20,
        'Target density': 0.3,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk',
        'Frequency max [MHz]': 100,
        'Bottom layer': 'MET2',
        'Top layer': 'MET5',
      }))

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(readProjectTextFile).toHaveBeenCalledWith('/workspace/demo/home/parameters.json')
    })

    const lifecycle = useWorkspaceLifecycle()
    const nextSession = lifecycle.beginSession({
      workspaceId: 'workspace-other',
      projectRoot: '/workspace/other',
    })
    lifecycle.activateSession(nextSession.sessionId)
    currentProject.value = { path: '/workspace/other' }
    resourceVersions.value = {
      ...resourceVersions.value,
      parameters: 1,
    }
    void parameters.loadParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('current-demo')
    })

    resolveOldRead?.(JSON.stringify({
      PDK: 'ics55',
      Design: 'stale-demo',
      'Top module': 'old_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
    }))
    await Promise.resolve()

    expect(parameters.config.design).toBe('current-demo')
    expect(parameters.config.topModule).toBe('chip_top')
  })

  it('does not let an old save mutate or invalidate a new project loaded in the same session', async () => {
    const firstWrite = createDeferred<void>()

    fetchSharedHomeData
      .mockResolvedValueOnce({
        parameters: '/workspace/demo/home/parameters.json',
      })
      .mockResolvedValueOnce({
        parameters: '/workspace/other/home/parameters.json',
      })
    readProjectTextFile
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'demo',
        'Top module': 'chip_top',
        Die: { Size: [100, 100], Area: 10000 },
        Core: {
          Size: [80, 80],
          Area: 6400,
          'Bounding box': '(0,0) (80,80)',
          Utilitization: 0.5,
          Margin: [4, 4],
          'Aspect ratio': 1,
        },
        'Max fanout': 20,
        'Target density': 0.3,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk',
        'Frequency max [MHz]': 100,
        'Bottom layer': 'MET2',
        'Top layer': 'MET5',
        'PDK Root': '/pdks/ics55',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        PDK: 'ics55',
        Design: 'other',
        'Top module': 'other_top',
        Die: { Size: [120, 120], Area: 14400 },
        Core: {
          Size: [90, 90],
          Area: 8100,
          'Bounding box': '(0,0) (90,90)',
          Utilitization: 0.6,
          Margin: [5, 5],
          'Aspect ratio': 1,
        },
        'Max fanout': 24,
        'Target density': 0.4,
        'Target overflow': 0.1,
        'Global right padding': 0,
        'Cell padding x': 600,
        'Routability opt flag': 1,
        Clock: 'clk2',
        'Frequency max [MHz]': 120,
        'Bottom layer': 'MET3',
        'Top layer': 'MET6',
        'PDK Root': '/pdks/ics55',
      }))
    writeProjectTextFile.mockReturnValueOnce(firstWrite.promise)

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'updated_demo'
    const savePromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    currentProject.value = { path: '/workspace/other' }
    await parameters.loadParameters()
    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('other')
    })

    parameters.config.design = 'other_dirty'
    await vi.waitFor(() => {
      expect(parameters.hasChanges.value).toBe(true)
    })

    const invalidateCountBeforeResolve = invalidateWorkspaceResources.mock.calls.length
    const versionsBeforeResolve = { ...resourceVersions.value }

    firstWrite.resolve()
    await expect(savePromise).resolves.toBe(true)

    expect(parameters.config.design).toBe('other_dirty')
    expect(parameters.hasChanges.value).toBe(true)
    expect(parameters.isSaving.value).toBe(false)
    expect(parameters.error.value).toBeNull()
    expect(invalidateWorkspaceResources).toHaveBeenCalledTimes(invalidateCountBeforeResolve)
    expect(resourceVersions.value).toEqual(versionsBeforeResolve)
  })

  it('keeps later saves serialized after reset while an earlier write is still in flight', async () => {
    const firstWrite = createDeferred<void>()
    const secondWrite = createDeferred<void>()

    fetchSharedHomeData
      .mockResolvedValueOnce({
        parameters: '/workspace/demo/home/parameters.json',
      })
      .mockResolvedValueOnce({
        parameters: '/workspace/demo/home/parameters.json',
      })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise)

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'save_a'
    const saveAPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    currentProject.value = null
    await parameters.loadParameters()
    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('')
    })

    currentProject.value = { path: '/workspace/demo' }
    await parameters.loadParameters()
    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })

    parameters.config.design = 'save_b'
    const saveBPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(parameters.isSaving.value).toBe(true)
    })
    expect(writeProjectTextFile).toHaveBeenCalledTimes(1)

    firstWrite.resolve()
    await expect(saveAPromise).resolves.toBe(true)

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(2)
    })

    secondWrite.resolve()
    await expect(saveBPromise).resolves.toBe(true)

    expect(parameters.config.design).toBe('save_b')
    expect(parameters.hasChanges.value).toBe(false)
    expect(parameters.error.value).toBeNull()
  })

  it('skips a stale queued save before path resolution and disk write after project reset', async () => {
    const firstWrite = createDeferred<void>()

    fetchSharedHomeData.mockResolvedValue({
      parameters: '/workspace/demo/home/parameters.json',
    })
    readProjectTextFile.mockResolvedValue(JSON.stringify({
      PDK: 'ics55',
      Design: 'demo',
      'Top module': 'chip_top',
      Die: { Size: [100, 100], Area: 10000 },
      Core: {
        Size: [80, 80],
        Area: 6400,
        'Bounding box': '(0,0) (80,80)',
        Utilitization: 0.5,
        Margin: [4, 4],
        'Aspect ratio': 1,
      },
      'Max fanout': 20,
      'Target density': 0.3,
      'Target overflow': 0.1,
      'Global right padding': 0,
      'Cell padding x': 600,
      'Routability opt flag': 1,
      Clock: 'clk',
      'Frequency max [MHz]': 100,
      'Bottom layer': 'MET2',
      'Top layer': 'MET5',
      'PDK Root': '/pdks/ics55',
    }))
    writeProjectTextFile
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined)

    const parameters = useParameters()

    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('demo')
    })
    expect(resolveProjectPathAccess).toHaveBeenCalledTimes(1)

    parameters.config.design = 'save_a'
    const saveAPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    parameters.config.design = 'save_b'
    const saveBPromise = parameters.saveParameters()

    await vi.waitFor(() => {
      expect(parameters.isSaving.value).toBe(true)
    })
    expect(resolveProjectPathAccess).toHaveBeenCalledTimes(2)
    expect(writeProjectTextFile).toHaveBeenCalledTimes(1)

    currentProject.value = null
    await parameters.loadParameters()
    await vi.waitFor(() => {
      expect(parameters.config.design).toBe('')
    })

    firstWrite.resolve()
    await expect(saveAPromise).resolves.toBe(true)
    await expect(saveBPromise).resolves.toBe(false)

    expect(resolveProjectPathAccess).toHaveBeenCalledTimes(2)
    expect(writeProjectTextFile).toHaveBeenCalledTimes(1)
    expect(parameters.isSaving.value).toBe(false)
  })
})
