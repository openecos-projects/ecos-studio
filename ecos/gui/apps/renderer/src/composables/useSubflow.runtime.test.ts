const testState = vi.hoisted(() => ({
  currentProject: null as import('vue').Ref<{ path: string } | null> | null,
  readProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
  resolveWorkspaceStepInfoApi: vi.fn(),
  route: {
    path: '/workspace/Floorplan',
  },
  runtimeEvents: null as import('vue').Ref<unknown[]> | null,
  resourceVersions: null as import('vue').Ref<{
    home: number
    flow: number
    parameters: number
    step: number
    'step-config': number
    maps: number
    logs: number
    all: number
  }> | null,
}))

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

vi.mock('vue-router', () => ({
  useRoute: () => testState.route,
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    runtimeEvents: testState.runtimeEvents,
    resourceVersions: testState.resourceVersions,
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
}))

vi.mock('@/utils/projectFs', () => ({
  resolveProjectPathAccess: testState.resolveProjectPathAccess,
}))

import { useSubflow } from './useSubflow'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'

describe('useSubflow runtime refresh', () => {
  beforeEach(() => {
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    const session = lifecycle.beginSession({
      workspaceId: 'workspace-demo',
      projectRoot: '/workspace/demo',
    })
    lifecycle.activateSession(session.sessionId)
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.route.path = '/workspace/floorplan'
    testState.runtimeEvents = ref([])
    testState.resourceVersions = ref({
      home: 0,
      flow: 0,
      parameters: 0,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      all: 0,
    })
    testState.readProjectTextFile.mockReset()
    testState.resolveProjectPathAccess.mockClear()
    testState.resolveWorkspaceStepInfoApi.mockReset()

    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        path: '/workspace/demo/Floorplan/subflow.json',
      },
      missing: [],
      message: [],
      id: 'subflow',
      step: 'Floorplan',
    })
    testState.readProjectTextFile.mockResolvedValue(JSON.stringify({
      path: '/workspace/demo/Floorplan/subflow.json',
      steps: [
        {
          name: 'floorplan',
          state: 'Success',
          runtime: '1.0s',
          'peak memory (mb)': 12,
          info: {},
        },
      ],
    }))
  })

  it('reloads the current subflow when the workspace step resource version changes', async () => {
    useSubflow()

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(1)
    })

    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      step: 1,
    }
    await nextTick()

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledTimes(2)
    })
  })

  it('ignores a stale subflow read after the workspace session changes', async () => {
    let resolveFirstRead: ((content: string) => void) | undefined
    testState.readProjectTextFile
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirstRead = resolve
      }))
      .mockResolvedValueOnce(JSON.stringify({
        path: '/workspace/other/Floorplan/subflow.json',
        steps: [
          {
            name: 'current-floorplan',
            state: 'Success',
            runtime: '1.0s',
            'peak memory (mb)': 10,
            info: {},
          },
        ],
      }))

    const subflow = useSubflow()

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
    testState.resourceVersions!.value = {
      ...testState.resourceVersions!.value,
      step: 1,
    }
    await nextTick()

    await vi.waitFor(() => {
      expect(subflow.subflowSteps.value.map((step) => step.name)).toEqual(['current-floorplan'])
    })

    resolveFirstRead?.(JSON.stringify({
      path: '/workspace/demo/Floorplan/subflow.json',
      steps: [
        {
          name: 'stale-floorplan',
          state: 'Success',
          runtime: '1.0s',
          'peak memory (mb)': 10,
          info: {},
        },
      ],
    }))
    await nextTick()

    expect(subflow.subflowSteps.value.map((step) => step.name)).toEqual(['current-floorplan'])
  })
})
