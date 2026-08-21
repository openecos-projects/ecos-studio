const testState = vi.hoisted(() => ({
  currentProject: null as import('vue').Ref<{ path: string } | null> | null,
  readProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
  resolveWorkspaceStepInfoApi: vi.fn(),
  route: {
    path: '/workspace/floorplan',
  },
  syncConfigApi: vi.fn(),
  writeProjectTextFile: vi.fn(),
}))

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch, type EffectScope } from 'vue'
import { InfoEnum, StepEnum } from '@/api/type'

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({
    isDesktopRuntimeAvailable: true,
  }),
}))

vi.mock('./useHomeData', () => ({
  convertRemoteToLocalPath: (path: string) => path,
}))

vi.mock('@/api/workspaceResources', () => ({
  resolveWorkspaceStepInfoApi: testState.resolveWorkspaceStepInfoApi,
}))

vi.mock('@/utils/projectFiles', () => ({
  readProjectTextFile: testState.readProjectTextFile,
  writeProjectTextFile: testState.writeProjectTextFile,
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

vi.mock('@/api/flow', () => ({
  syncConfigApi: testState.syncConfigApi,
}))

import { useStepConfigInfo } from './useStepConfigInfo'
import {
  clearFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
} from './useFlowRunner'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'

describe('useStepConfigInfo', () => {
  let scope: EffectScope

  beforeEach(() => {
    scope = effectScope()
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    const session = lifecycle.beginSession({
      workspaceId: 'workspace-demo',
      projectRoot: '/workspace/demo',
    })
    lifecycle.activateSession(session.sessionId)
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.route.path = '/workspace/floorplan'
    testState.readProjectTextFile.mockReset()
    testState.resolveProjectPathAccess.mockClear()
    testState.resolveWorkspaceStepInfoApi.mockReset()
    testState.syncConfigApi.mockReset()
    testState.syncConfigApi.mockResolvedValue({
      cmd: 'sync_config',
      data: {
        config_path: '/workspace/demo/config/floorplan_ecc.json',
        directory: '/workspace/demo',
        parameters_changed: false,
        refreshed: false,
      },
      message: ['synced'],
      response: 'success',
    })
    testState.writeProjectTextFile.mockReset()
    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  afterEach(() => {
    scope.stop()
  })

  it('treats missing config info without a config path as an empty state', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'missing',
      info: {},
      missing: ['config'],
      message: ['No config path for Floorplan'],
      id: 'config',
      step: 'Floorplan',
    })

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.responseKind.value).toBe('idle')
    expect(result.isEmpty.value).toBe(true)
    expect(result.stepConfigPathResolved.value).toBeNull()
    expect(testState.readProjectTextFile).not.toHaveBeenCalled()
  })

  it('treats available config info without a config path as an empty state', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {},
      missing: [],
      message: [],
      id: 'config',
      step: 'Synthesis',
    })
    testState.route.path = '/workspace/synthesis'

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.responseKind.value).toBe('success')
    expect(result.isEmpty.value).toBe(true)
    expect(result.stepConfigPathResolved.value).toBeNull()
    expect(testState.readProjectTextFile).not.toHaveBeenCalled()
  })

  it('keeps non-config missing metadata from rendering a blank config panel', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'missing',
      info: {
        metrics: '/workspace/demo/Floorplan/metrics.json',
      },
      missing: ['config'],
      message: ['No config path for Floorplan'],
      id: 'config',
      step: 'Floorplan',
    })

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.responseKind.value).toBe('idle')
    expect(result.isEmpty.value).toBe(true)
    expect(result.stepConfigPathResolved.value).toBeNull()
    expect(testState.readProjectTextFile).not.toHaveBeenCalled()
  })

  it('treats a missing config file path as an empty state without reading it', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'missing',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: ['config/floorplan_ecc.json'],
      message: ['Config file is missing'],
      id: 'config',
      step: 'Floorplan',
    })
    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.loading.value).toBe(false)
    })

    expect(result.responseKind.value).toBe('idle')
    expect(result.isEmpty.value).toBe(true)
    expect(result.stepConfigPathResolved.value).toBeNull()
    expect(testState.readProjectTextFile).not.toHaveBeenCalled()
  })

  it('loads a synthesis config supplied through the legacy path field', async () => {
    testState.route.path = '/workspace/synthesis'
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        path: '/workspace/demo/config/flow_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Synthesis',
    })
    testState.readProjectTextFile.mockResolvedValue('{"SYNTHESIS":{}}')

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigPathResolved.value).toBe(
        '/workspace/demo/config/flow_ecc.json',
      )
    })
    expect(result.stepConfigParsed.value).toEqual({ SYNTHESIS: {} })
  })

  it('uses an explicitly selected flow step instead of the current route', async () => {
    testState.route.path = '/workspace/synthesis'
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'missing',
      info: {},
      missing: ['config'],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    const selectedStep = ref<StepEnum | undefined>(StepEnum.FLOORPLAN)

    scope.run(() => useStepConfigInfo(selectedStep))!

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledWith({
        step: StepEnum.FLOORPLAN,
        id: InfoEnum.config,
      })
    })

    selectedStep.value = StepEnum.PLACEMENT

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenLastCalledWith({
        step: StepEnum.PLACEMENT,
        id: InfoEnum.config,
      })
    })

    const requestCount = testState.resolveWorkspaceStepInfoApi.mock.calls.length
    testState.route.path = '/workspace/routing'
    await nextTick()
    expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(requestCount)
  })

  it('ignores stale step config reads after the workspace session changes', async () => {
    let resolveOldRead: ((content: string) => void) | undefined
    testState.resolveWorkspaceStepInfoApi
      .mockResolvedValueOnce({
        response: 'available',
        info: {
          config: '/workspace/demo/config/floorplan_ecc.json',
        },
        missing: [],
        message: [],
        id: 'config',
        step: 'Floorplan',
      })
      .mockResolvedValueOnce({
        response: 'available',
        info: {
          config: '/workspace/other/config/floorplan_ecc.json',
        },
        missing: [],
        message: [],
        id: 'config',
        step: 'Floorplan',
      })
    testState.readProjectTextFile
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldRead = resolve
        }),
      )
      .mockResolvedValueOnce('{"owner":"current"}')

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(testState.readProjectTextFile).toHaveBeenCalledTimes(1)
    })

    const lifecycle = useWorkspaceLifecycle()
    const nextSession = lifecycle.beginSession({
      workspaceId: 'workspace-other',
      projectRoot: '/workspace/other',
    })
    lifecycle.activateSession(nextSession.sessionId)
    testState.currentProject!.value = { path: '/workspace/other' }
    void result.refetch()

    await vi.waitFor(() => {
      expect(result.stepConfigRaw.value).toBe('{"owner":"current"}')
    })

    resolveOldRead?.('{"owner":"stale"}')
    await nextTick()

    expect(result.stepConfigRaw.value).toBe('{"owner":"current"}')
    expect(result.stepConfigPathResolved.value).toBe(
      '/workspace/other/config/floorplan_ecc.json',
    )
  })

  it('ignores older same-session refetch completions after a newer refetch wins', async () => {
    let resolveOldResponse:
      | ((response: {
          response: 'available'
          info: { config: string }
          missing: string[]
          message: string[]
          id: string
          step: string
        }) => void)
      | undefined
    testState.resolveWorkspaceStepInfoApi
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldResponse = resolve
        }),
      )
      .mockResolvedValueOnce({
        response: 'available',
        info: {
          config: '/workspace/demo/config/fp_b.json',
        },
        missing: [],
        message: ['B'],
        id: 'config',
        step: 'Floorplan',
      })
    testState.readProjectTextFile.mockImplementation(async (path: string) =>
      path.includes('fp_a.json') ? '{"owner":"A"}' : '{"owner":"B"}',
    )

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(1)
    })

    const newerRefetch = result.refetch()

    await vi.waitFor(() => {
      expect(result.stepConfigRaw.value).toBe('{"owner":"B"}')
    })
    await newerRefetch

    resolveOldResponse?.({
      response: 'available',
      info: {
        config: '/workspace/demo/config/fp_a.json',
      },
      missing: [],
      message: ['A'],
      id: 'config',
      step: 'Floorplan',
    })
    await nextTick()

    expect(result.stepConfigRaw.value).toBe('{"owner":"B"}')
    expect(result.stepConfigPathResolved.value).toBe('/workspace/demo/config/fp_b.json')
    expect(result.runtimeMessages.value).toEqual(['B'])
    expect(result.responseKind.value).toBe('success')
    expect(result.loading.value).toBe(false)
    expect(testState.readProjectTextFile).not.toHaveBeenCalledWith(
      '/workspace/demo/config/fp_a.json',
    )
  })

  it('reloads the current step when step config resource versions change', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.readProjectTextFile.mockResolvedValue('{"FP":{}}')

    scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(1)
    })

    const lifecycle = useWorkspaceLifecycle()
    lifecycle.invalidate('step-config')
    await nextTick()

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(2)
    })

    lifecycle.invalidate('all')
    await nextTick()

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(3)
    })
  })

  it('save writes the config and updates the local baseline', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.readProjectTextFile
      .mockResolvedValueOnce('{"density":0.5}')
      .mockResolvedValue('{\n    "density": 0.6\n}')

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({ density: 0.5 })
    })

    result.stepConfigDraft.value = { density: 0.6 }

    expect(result.hasStepConfigChanges.value).toBe(true)
    const lifecycle = useWorkspaceLifecycle()
    const stepConfigVersionBeforeSave = lifecycle.resourceVersions.value['step-config']
    const stepVersionBeforeSave = lifecycle.resourceVersions.value.step
    await expect(result.saveStepConfig()).resolves.toBe(true)

    expect(testState.writeProjectTextFile).toHaveBeenCalledWith(
      '/workspace/demo/config/floorplan_ecc.json',
      '{\n    "density": 0.6\n}',
    )
    expect(testState.syncConfigApi).toHaveBeenCalledWith({
      cmd: 'sync_config',
      data: {
        config_path: '/workspace/demo/config/floorplan_ecc.json',
        directory: '/workspace/demo',
        workspaceHandle: 'workspace-demo',
      },
    })
    expect(lifecycle.resourceVersions.value['step-config']).toBe(
      stepConfigVersionBeforeSave + 1,
    )
    expect(lifecycle.resourceVersions.value.step).toBe(stepVersionBeforeSave + 1)
    await vi.waitFor(() => {
      expect(result.stepConfigRaw.value).toBe('{\n    "density": 0.6\n}')
      expect(result.hasStepConfigChanges.value).toBe(false)
    })
  })

  it('pins route step config routing layers when loading and saving', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/route_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'route',
    })
    testState.readProjectTextFile.mockResolvedValue(
      JSON.stringify({
        RT: {
          '-bottom_routing_layer': 'MET1',
          '-top_routing_layer': 'MET6',
          '-thread_number': '50',
        },
      }),
    )
    testState.route.path = '/workspace/route'

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({
        RT: {
          '-bottom_routing_layer': 'MET2',
          '-top_routing_layer': 'MET5',
          '-thread_number': '50',
        },
      })
    })
    expect(result.hasStepConfigChanges.value).toBe(true)

    await expect(result.saveStepConfig()).resolves.toBe(true)

    const savedContent = testState.writeProjectTextFile.mock.calls[0][1] as string
    expect(JSON.parse(savedContent)).toEqual({
      RT: {
        '-bottom_routing_layer': 'MET2',
        '-top_routing_layer': 'MET5',
        '-thread_number': '50',
      },
    })
    await vi.waitFor(() => {
      expect(result.hasStepConfigChanges.value).toBe(false)
    })
  })

  it('does not treat editor-created empty containers as unsaved changes', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: { config: '/workspace/demo/config/floorplan_ecc.json' },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.readProjectTextFile.mockResolvedValue('{}')

    const result = scope.run(() => useStepConfigInfo())!
    watch(
      result.stepConfigDraft,
      (draft) => {
        if (draft && typeof draft === 'object' && !('Floorplan' in draft)) {
          ;(draft as Record<string, unknown>).Floorplan = {}
        }
      },
      { deep: true },
    )

    await vi.waitFor(() =>
      expect(result.stepConfigDraft.value).toEqual({ Floorplan: {} }),
    )
    result.markStepConfigEditorInitialized()
    expect(result.hasStepConfigChanges.value).toBe(false)

    ;(result.stepConfigDraft.value as Record<string, unknown>).Floorplan = {
      'Tap distance': 10,
    }
    expect(result.hasStepConfigChanges.value).toBe(true)

    result.resetStepConfig()
    await nextTick()
    expect(result.hasStepConfigChanges.value).toBe(false)
  })

  it('rejects step config saves while the workspace flow is running', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.readProjectTextFile.mockResolvedValue('{"density":0.5}')

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({ density: 0.5 })
    })

    result.stepConfigDraft.value = { density: 0.7 }
    markFlowExecutionActiveForWorkspace('/workspace/demo')

    await expect(result.saveStepConfig()).resolves.toBe(false)

    expect(testState.writeProjectTextFile).not.toHaveBeenCalled()
    expect(result.stepConfigSaveError.value).toContain('Flow is running')
  })

  it('invalidates parameters and home when step config sync changes parameters', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/route_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'route',
    })
    testState.readProjectTextFile
      .mockResolvedValueOnce(
        '{"RT":{"-bottom_routing_layer":"MET2","-top_routing_layer":"MET5","-thread_number":"50"}}',
      )
      .mockResolvedValue(
        '{\n    "RT": {\n        "-bottom_routing_layer": "MET4"\n    }\n}',
      )
    testState.syncConfigApi.mockResolvedValue({
      cmd: 'sync_config',
      data: {
        config_path: '/workspace/demo/config/route_ecc.json',
        directory: '/workspace/demo',
        parameters_changed: true,
        refreshed: true,
      },
      message: ['synced'],
      response: 'success',
    })

    testState.route.path = '/workspace/route'
    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({
        RT: {
          '-bottom_routing_layer': 'MET2',
          '-top_routing_layer': 'MET5',
          '-thread_number': '50',
        },
      })
    })

    const lifecycle = useWorkspaceLifecycle()
    const initialVersions = { ...lifecycle.resourceVersions.value }
    result.stepConfigDraft.value = {
      RT: {
        '-bottom_routing_layer': 'MET2',
        '-top_routing_layer': 'MET5',
        '-thread_number': '64',
      },
    }

    await expect(result.saveStepConfig()).resolves.toBe(true)

    expect(lifecycle.resourceVersions.value['step-config']).toBe(
      initialVersions['step-config'] + 1,
    )
    expect(lifecycle.resourceVersions.value.parameters).toBe(
      initialVersions.parameters + 1,
    )
    expect(lifecycle.resourceVersions.value.home).toBe(initialVersions.home + 1)
  })

  it('keeps written step config as the baseline when sync config fails after save', async () => {
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.readProjectTextFile.mockResolvedValue('{"density":0.5}')
    testState.syncConfigApi.mockResolvedValue({
      cmd: 'sync_config',
      data: {
        config_path: '/workspace/demo/config/floorplan_ecc.json',
        directory: '/workspace/demo',
        parameters_changed: false,
        refreshed: false,
      },
      message: ['sync failed'],
      response: 'error',
    })

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({ density: 0.5 })
    })

    result.stepConfigDraft.value = { density: 0.9 }
    const stepVersionBeforeSave = useWorkspaceLifecycle().resourceVersions.value.step

    await expect(result.saveStepConfig()).resolves.toBe(false)

    expect(testState.writeProjectTextFile).toHaveBeenCalled()
    expect(result.hasStepConfigChanges.value).toBe(false)
    expect(result.stepConfigSaveError.value).toBe('sync failed')
    expect(useWorkspaceLifecycle().resourceVersions.value.step).toBe(
      stepVersionBeforeSave,
    )
  })

  it('ignores stale step config save completions after the workspace session changes', async () => {
    let resolveWrite: (() => void) | undefined
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.readProjectTextFile.mockResolvedValue('{"density":0.5}')
    testState.writeProjectTextFile.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveWrite = resolve
      }),
    )

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({ density: 0.5 })
    })

    result.stepConfigDraft.value = { density: 0.6 }
    expect(result.hasStepConfigChanges.value).toBe(true)

    const savePromise = result.saveStepConfig()

    await vi.waitFor(() => {
      expect(testState.writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    const lifecycle = useWorkspaceLifecycle()
    const nextSession = lifecycle.beginSession({
      workspaceId: 'workspace-other',
      projectRoot: '/workspace/other',
    })
    lifecycle.activateSession(nextSession.sessionId)
    testState.currentProject!.value = { path: '/workspace/other' }
    const nextStepConfigVersion = lifecycle.resourceVersions.value['step-config']

    resolveWrite?.()
    await expect(savePromise).resolves.toBe(false)

    expect(result.stepConfigRaw.value).toBe('{"density":0.5}')
    expect(result.hasStepConfigChanges.value).toBe(true)
    expect(lifecycle.resourceVersions.value['step-config']).toBe(nextStepConfigVersion)
  })

  it('keeps the newer same-session save result when an older save resolves last', async () => {
    let resolveOldWrite: (() => void) | undefined
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.readProjectTextFile
      .mockResolvedValueOnce('{"density":0.5}')
      .mockResolvedValue('{\n    "density": 0.8\n}')
    testState.writeProjectTextFile
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveOldWrite = resolve
        }),
      )
      .mockResolvedValueOnce(undefined)

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({ density: 0.5 })
    })

    const lifecycle = useWorkspaceLifecycle()
    const stepConfigVersionBeforeSave = lifecycle.resourceVersions.value['step-config']

    result.stepConfigDraft.value = { density: 0.6 }
    const oldSave = result.saveStepConfig()

    await vi.waitFor(() => {
      expect(testState.writeProjectTextFile).toHaveBeenCalledTimes(1)
    })

    result.stepConfigDraft.value = { density: 0.8 }
    const newerSave = result.saveStepConfig()

    await expect(newerSave).resolves.toBe(true)
    expect(result.stepConfigRaw.value).toBe('{\n    "density": 0.8\n}')
    expect(result.hasStepConfigChanges.value).toBe(false)
    expect(lifecycle.resourceVersions.value['step-config']).toBe(
      stepConfigVersionBeforeSave + 1,
    )

    resolveOldWrite?.()
    await expect(oldSave).resolves.toBe(false)

    expect(result.stepConfigRaw.value).toBe('{\n    "density": 0.8\n}')
    expect(result.hasStepConfigChanges.value).toBe(false)
    expect(lifecycle.resourceVersions.value['step-config']).toBe(
      stepConfigVersionBeforeSave + 1,
    )
  })

  it('captures the save payload before awaited path resolution completes', async () => {
    let resolveSavePath: ((path: string) => void) | undefined
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        config: '/workspace/demo/config/floorplan_ecc.json',
      },
      missing: [],
      message: [],
      id: 'config',
      step: 'Floorplan',
    })
    testState.resolveProjectPathAccess
      .mockResolvedValueOnce('/workspace/demo/config/floorplan_ecc.json')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSavePath = resolve
        }),
      )
    testState.readProjectTextFile.mockResolvedValue('{"density":0.5}')
    testState.writeProjectTextFile.mockResolvedValue(undefined)

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => {
      expect(result.stepConfigDraft.value).toEqual({ density: 0.5 })
    })

    result.stepConfigDraft.value = { density: 0.6 }
    const savePromise = result.saveStepConfig()

    await vi.waitFor(() => {
      expect(testState.resolveProjectPathAccess).toHaveBeenCalledTimes(2)
    })

    result.stepConfigDraft.value = { density: 0.8 }
    resolveSavePath?.('/workspace/demo/config/floorplan_ecc.json')

    await expect(savePromise).resolves.toBe(true)
    expect(testState.writeProjectTextFile).toHaveBeenCalledWith(
      '/workspace/demo/config/floorplan_ecc.json',
      '{\n    "density": 0.6\n}',
    )
  })
})
