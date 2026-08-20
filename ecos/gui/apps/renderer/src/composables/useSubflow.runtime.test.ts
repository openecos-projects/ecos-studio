const testState = vi.hoisted(() => ({
  currentProject: null as import('vue').Ref<{ path: string } | null> | null,
  readProjectTextFile: vi.fn(),
  resolveProjectPathAccess: vi.fn(async (path: string) => path),
  resolveWorkspaceStepInfoApi: vi.fn(),
  route: {
    path: '/workspace/Floorplan',
  },
  runtimeEvents: null as import('vue').Ref<unknown[]> | null,
  resourceVersions: null as
    | import('vue').Ref<{
        home: number
        flow: number
        parameters: number
        step: number
        'step-config': number
        maps: number
        logs: number
        all: number
      }>
    | null,
}))

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { InfoEnum, StepEnum } from '@/api/type'

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
    testState.readProjectTextFile.mockResolvedValue(
      JSON.stringify({
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
      }),
    )
  })

  it('loads the Harden subflow for the canonical Harden route', async () => {
    testState.route.path = '/workspace/Harden'
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        path: '/workspace/demo/Harden_ecc/subflow.json',
      },
      missing: [],
      message: [],
      id: 'subflow',
      step: 'Harden',
    })
    testState.readProjectTextFile.mockResolvedValue(
      JSON.stringify({
        path: '/workspace/demo/Harden_ecc/subflow.json',
        steps: [
          {
            name: 'run harden',
            state: 'Success',
            runtime: '9.0s',
            'peak memory (mb)': 830,
            info: {},
          },
        ],
      }),
    )

    const subflow = useSubflow()

    await vi.waitFor(() => {
      expect(testState.resolveWorkspaceStepInfoApi).toHaveBeenCalledWith({
        step: StepEnum.HARDEN,
        id: InfoEnum.subflow,
      })
    })
    await vi.waitFor(() => {
      expect(subflow.subflowSteps.value.map((step) => step.name)).toEqual(['run harden'])
    })
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

  it('keeps the rerun skeleton and applies live subflow-stage events', async () => {
    const subflow = useSubflow()

    await vi.waitFor(() => {
      expect(subflow.subflowSteps.value).toHaveLength(1)
    })

    testState.runtimeEvents!.value.push({
      data: {
        runtimeProtocolType: 'step.started',
        step: 'Floorplan',
      },
    })
    await nextTick()
    expect(subflow.subflowSteps.value[0]).toMatchObject({
      name: 'floorplan',
      status: 'running',
    })

    testState.runtimeEvents!.value.push({
      data: {
        runtimeProtocolType: 'subflow.stage',
        state: 'Success',
        step: 'Floorplan',
        subflowPeakMemory: 24,
        subflowRuntime: '0:0:3',
        subflowStep: 'floorplan',
      },
    })
    await nextTick()
    expect(subflow.subflowSteps.value[0]).toMatchObject({
      duration: '0:0:3',
      peakMemory: 24,
      status: 'completed',
    })
  })

  it('resets the rerun skeleton for legacy ecc-fe step-start events', async () => {
    const subflow = useSubflow()

    await vi.waitFor(() => {
      expect(subflow.subflowSteps.value[0]?.status).toBe('completed')
    })

    testState.runtimeEvents!.value.push({
      data: {
        step: 'Floorplan',
        type: 'step_start',
      },
    })
    await nextTick()

    expect(subflow.subflowSteps.value[0]?.status).toBe('running')
  })

  it('builds and advances a first-run frontend subflow from live stages', async () => {
    testState.route.path = '/workspace/prepare'
    testState.resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: { path: '/workspace/demo/prepare_fe/subflow.json' },
      missing: [],
      message: [],
      id: 'subflow',
      step: 'prepare',
    })
    testState.readProjectTextFile.mockResolvedValue(
      JSON.stringify({
        path: '/workspace/demo/prepare_fe/subflow.json',
        steps: [],
      }),
    )
    const subflow = useSubflow()

    await vi.waitFor(() => {
      expect(testState.readProjectTextFile).toHaveBeenCalled()
    })

    testState.runtimeEvents!.value.push({
      data: {
        step: 'prepare',
        type: 'step_start',
      },
    })

    for (const name of ['collect inputs', 'merge filelist', 'persist state', 'report']) {
      testState.runtimeEvents!.value.push({
        data: {
          runtimeProtocolType: 'subflow.stage',
          state: 'Unstart',
          step: 'prepare',
          subflowPeakMemory: 0,
          subflowRuntime: '',
          subflowStep: name,
        },
      })
    }
    await nextTick()
    expect(subflow.subflowSteps.value.map((step) => step.status)).toEqual([
      'running',
      'pending',
      'pending',
      'pending',
    ])

    testState.runtimeEvents!.value.push({
      data: {
        runtimeProtocolType: 'subflow.stage',
        state: 'Success',
        step: 'prepare',
        subflowPeakMemory: 8,
        subflowRuntime: '0:0:1',
        subflowStep: 'collect inputs',
      },
    })
    await nextTick()

    expect(subflow.subflowSteps.value.map((step) => step.status)).toEqual([
      'completed',
      'running',
      'pending',
      'pending',
    ])
  })

  it('ignores a stale subflow read after the workspace session changes', async () => {
    let resolveFirstRead: ((content: string) => void) | undefined
    testState.readProjectTextFile
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstRead = resolve
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
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
        }),
      )

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
      expect(subflow.subflowSteps.value.map((step) => step.name)).toEqual([
        'current-floorplan',
      ])
    })

    resolveFirstRead?.(
      JSON.stringify({
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
      }),
    )
    await nextTick()

    expect(subflow.subflowSteps.value.map((step) => step.name)).toEqual([
      'current-floorplan',
    ])
  })
})
