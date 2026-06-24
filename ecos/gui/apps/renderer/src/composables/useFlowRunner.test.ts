import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StateEnum, StepEnum } from '@/api/type'

const {
  ensureDesktopRuntime,
  ensureApiReady,
  showToast,
  invalidateWorkspaceResources,
  resourceVersions,
  workspaceSession,
  runStepApi,
  rtl2gdsApi,
  currentProject,
  requestHomeRunArtifactReset,
  markHomeRunArtifactResetAwaitingBackendStart,
  clearHomeRunArtifactResetAwaitingBackendStart,
} = vi.hoisted(() => ({
  ensureDesktopRuntime: vi.fn(() => false),
  ensureApiReady: vi.fn(() => Promise.resolve(true)),
  showToast: vi.fn(),
  invalidateWorkspaceResources: vi.fn(),
  resourceVersions: {
    value: {
      home: 0,
      flow: 0,
      parameters: 0,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      all: 0,
    },
  },
  workspaceSession: {
    value: {
      sessionId: 'session-1',
    },
  },
  runStepApi: vi.fn(),
  rtl2gdsApi: vi.fn(),
  currentProject: { value: null as { path: string } | null },
  requestHomeRunArtifactReset: vi.fn(),
  markHomeRunArtifactResetAwaitingBackendStart: vi.fn(),
  clearHomeRunArtifactResetAwaitingBackendStart: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: {
      step: StepEnum.FLOORPLAN,
    },
  }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({
    isDesktopRuntimeAvailable: false,
    ensureDesktopRuntime,
  }),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject,
    ensureApiReady,
    showToast,
    invalidateWorkspaceResources,
    resourceVersions,
    workspaceSession,
  }),
}))

vi.mock('@/api/flow', () => ({
  runStepApi,
  rtl2gdsApi,
}))

vi.mock('./homeRunArtifacts', () => ({
  requestHomeRunArtifactReset,
  markHomeRunArtifactResetAwaitingBackendStart,
  clearHomeRunArtifactResetAwaitingBackendStart,
}))

import {
  clearFlowExecutionActiveForWorkspace,
  flowExecutionActive,
  markFlowExecutionActiveForWorkspace,
  useFlowRunner,
} from './useFlowRunner'

describe('useFlowRunner desktop-only guard', () => {
  beforeEach(() => {
    ensureDesktopRuntime.mockReset()
    ensureDesktopRuntime.mockReturnValue(false)
    ensureApiReady.mockReset()
    ensureApiReady.mockResolvedValue(true)
    showToast.mockReset()
    invalidateWorkspaceResources.mockReset()
    resourceVersions.value = {
      home: 0,
      flow: 0,
      parameters: 0,
      step: 0,
      'step-config': 0,
      maps: 0,
      logs: 0,
      all: 0,
    }
    workspaceSession.value = {
      sessionId: 'session-1',
    }
    runStepApi.mockReset()
    rtl2gdsApi.mockReset()
    requestHomeRunArtifactReset.mockReset()
    markHomeRunArtifactResetAwaitingBackendStart.mockReset()
    clearHomeRunArtifactResetAwaitingBackendStart.mockReset()
    flowExecutionActive.value = false
    currentProject.value = null
  })

  it('shows a toast when running a single step outside the desktop runtime', async () => {
    const { runFlow } = useFlowRunner()

    const result = await runFlow()

    expect(ensureDesktopRuntime).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Desktop App Required',
      detail: 'Flow execution is only available in the desktop app.',
      life: 5000,
    })
    expect(runStepApi).not.toHaveBeenCalled()
    expect(ensureApiReady).not.toHaveBeenCalled()
    expect(result).toEqual({
      step: StepEnum.FLOORPLAN,
      state: StateEnum.Invalid,
    })
  })

  it('shows a toast when running the full flow outside the desktop runtime', async () => {
    const { runAllFlow } = useFlowRunner()

    const result = await runAllFlow()

    expect(ensureDesktopRuntime).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Desktop App Required',
      detail: 'Flow execution is only available in the desktop app.',
      life: 5000,
    })
    expect(rtl2gdsApi).not.toHaveBeenCalled()
    expect(ensureApiReady).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('resolves the full flow API result without directly refreshing resources', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    rtl2gdsApi.mockResolvedValue({
      response: 'success',
      data: { rerun: false },
      message: ['done'],
    })

    const { runAllFlow } = useFlowRunner()

    await expect(runAllFlow()).resolves.toEqual({ rerun: false })
    expect(rtl2gdsApi).toHaveBeenCalledWith({
      cmd: 'rtl2gds',
      data: {
        directory: '/work/demo',
        rerun: false,
      },
    })
    expect(requestHomeRunArtifactReset).not.toHaveBeenCalled()
  })

  it('passes rerun=true to the full flow API when requested', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    rtl2gdsApi.mockResolvedValue({
      response: 'success',
      data: { rerun: true },
      message: ['done'],
    })

    const { runAllFlow } = useFlowRunner()

    await expect(runAllFlow({ rerun: true })).resolves.toEqual({ rerun: true })
    expect(requestHomeRunArtifactReset).not.toHaveBeenCalled()
    expect(rtl2gdsApi).toHaveBeenCalledWith({
      cmd: 'rtl2gds',
      data: {
        directory: '/work/demo',
        rerun: true,
      },
    })
  })

  it('does not mark the full flow running when the runtime bridge is unavailable', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    ensureApiReady.mockResolvedValue(false)

    const { runAllFlow, isRunning } = useFlowRunner()

    await expect(runAllFlow()).resolves.toBeNull()

    expect(ensureApiReady).toHaveBeenCalledTimes(1)
    expect(rtl2gdsApi).not.toHaveBeenCalled()
    expect(isRunning.value).toBe(false)
  })

  it('sends the active project directory when running a single step', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    runStepApi.mockResolvedValue({
      data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
      message: ['done'],
      response: 'success',
    })

    const { runFlow } = useFlowRunner()

    await runFlow()

    expect(runStepApi).toHaveBeenCalledWith({
      cmd: 'run_step',
      data: {
        directory: '/work/demo',
        rerun: false,
        step: StepEnum.FLOORPLAN,
      },
    })
  })

  it('passes rerun=true to the single step API when requested', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    runStepApi.mockResolvedValue({
      data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
      message: ['done'],
      response: 'success',
    })

    const { runFlow } = useFlowRunner()

    await runFlow({ rerun: true })

    expect(requestHomeRunArtifactReset).not.toHaveBeenCalled()
    expect(runStepApi).toHaveBeenCalledWith({
      cmd: 'run_step',
      data: {
        directory: '/work/demo',
        rerun: true,
        step: StepEnum.FLOORPLAN,
      },
    })
  })

  it('invalidates Home and parameters after a single step completes without runtime events', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    runStepApi.mockResolvedValue({
      data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
      message: ['done'],
      response: 'success',
    })

    const { runFlow } = useFlowRunner()

    await runFlow()

    expect(invalidateWorkspaceResources).toHaveBeenCalledWith(
      ['home', 'parameters'],
      { sessionId: 'session-1' },
    )
  })

  it('still invalidates Home and parameters when runtime events only updated flow resources', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    runStepApi.mockImplementation(async () => {
      resourceVersions.value = {
        ...resourceVersions.value,
        flow: resourceVersions.value.flow + 1,
      }
      return {
        data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
        message: ['done'],
        response: 'success',
      }
    })

    const { runFlow } = useFlowRunner()

    await runFlow()

    expect(invalidateWorkspaceResources).toHaveBeenCalledWith(
      ['home', 'parameters'],
      { sessionId: 'session-1' },
    )
  })

  it('does not duplicate fallback invalidations when runtime events already updated Home and parameters', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    runStepApi.mockImplementation(async () => {
      resourceVersions.value = {
        ...resourceVersions.value,
        home: resourceVersions.value.home + 1,
        parameters: resourceVersions.value.parameters + 1,
      }
      return {
        data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
        message: ['done'],
        response: 'success',
      }
    })

    const { runFlow } = useFlowRunner()

    await runFlow()

    expect(invalidateWorkspaceResources).not.toHaveBeenCalled()
  })

  it('binds fallback invalidation to the workspace session active when the step started', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    workspaceSession.value = {
      sessionId: 'session-a',
    }
    currentProject.value = { path: '/work/a' }
    let resolveRunStep: ((value: {
      data: { state: StateEnum; step: StepEnum }
      message: string[]
      response: string
    }) => void) | undefined
    runStepApi.mockReturnValue(new Promise((resolve) => {
      resolveRunStep = resolve
    }))

    const { runFlow } = useFlowRunner()
    const runPromise = runFlow()
    await vi.waitFor(() => {
      expect(runStepApi).toHaveBeenCalled()
    })

    workspaceSession.value = {
      sessionId: 'session-b',
    }
    currentProject.value = { path: '/work/b' }
    resolveRunStep?.({
      data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
      message: ['done'],
      response: 'success',
    })

    await runPromise

    expect(invalidateWorkspaceResources).toHaveBeenCalledWith(
      ['home', 'parameters'],
      { sessionId: 'session-a' },
    )
  })

  it('tracks running flow state per workspace', () => {
    currentProject.value = { path: '/work/a' }
    const workspaceA = useFlowRunner()
    currentProject.value = { path: '/work/b' }
    const workspaceB = useFlowRunner()

    markFlowExecutionActiveForWorkspace('/work/a')

    currentProject.value = { path: '/work/a' }
    expect(workspaceA.isRunning.value).toBe(true)
    currentProject.value = { path: '/work/b' }
    expect(workspaceB.isRunning.value).toBe(false)
    expect(flowExecutionActive.value).toBe(true)

    clearFlowExecutionActiveForWorkspace('/work/a')

    expect(flowExecutionActive.value).toBe(false)
  })
})
