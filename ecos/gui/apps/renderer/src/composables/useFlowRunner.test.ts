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
  startFlowOperationApi,
  startStepOperationApi,
  waitForRuntimeOperation,
  currentProject,
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
      workspaceId: 'workspace-demo',
      state: undefined as string | undefined,
    },
  },
  runStepApi: vi.fn(),
  rtl2gdsApi: vi.fn(),
  startFlowOperationApi: vi.fn(),
  startStepOperationApi: vi.fn(),
  waitForRuntimeOperation: vi.fn(),
  currentProject: {
    value: null as { path: string; designTool?: 'backend' | 'frontend' } | null,
  },
  markHomeRunArtifactResetAwaitingBackendStart: vi.fn(),
  clearHomeRunArtifactResetAwaitingBackendStart: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { step: StepEnum.FLOORPLAN } }),
}))

vi.mock('./useDesktopRuntime', () => ({
  useDesktopRuntime: () => ({ ensureDesktopRuntime }),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject,
    ensureApiReady,
    showToast,
    invalidateWorkspaceResources,
    resourceVersions,
    workspaceSession,
    waitForRuntimeOperation,
  }),
}))

vi.mock('@/api/flow', () => ({
  runStepApi,
  rtl2gdsApi,
  startFlowOperationApi,
  startStepOperationApi,
}))

vi.mock('./homeRunArtifacts', () => ({
  markHomeRunArtifactResetAwaitingBackendStart,
  clearHomeRunArtifactResetAwaitingBackendStart,
}))

import {
  clearFlowExecutionActiveForWorkspace,
  flowExecutionActive,
  markFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
  useFlowRunner,
} from './useFlowRunner'

describe('useFlowRunner desktop and design-tool routing', () => {
  beforeEach(() => {
    ensureDesktopRuntime.mockReset()
    ensureDesktopRuntime.mockReturnValue(false)
    ensureApiReady.mockReset()
    ensureApiReady.mockResolvedValue(true)
    showToast.mockReset()
    invalidateWorkspaceResources.mockReset()
    runStepApi.mockReset()
    rtl2gdsApi.mockReset()
    startFlowOperationApi.mockReset()
    startStepOperationApi.mockReset()
    waitForRuntimeOperation.mockReset()
    waitForRuntimeOperation.mockImplementation(() => new Promise<void>(() => undefined))
    markHomeRunArtifactResetAwaitingBackendStart.mockReset()
    clearHomeRunArtifactResetAwaitingBackendStart.mockReset()
    workspaceSession.value = {
      sessionId: 'session-1',
      workspaceId: 'workspace-demo',
      state: undefined,
    }
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
    resetFlowExecutionState()
    currentProject.value = null
  })

  it('guards both run modes outside the desktop runtime', async () => {
    const runner = useFlowRunner()
    await expect(runner.runFlow()).resolves.toEqual({
      step: StepEnum.FLOORPLAN,
      state: StateEnum.Invalid,
    })
    await expect(runner.runAllFlow()).resolves.toBeNull()
    expect(ensureApiReady).not.toHaveBeenCalled()
    expect(startStepOperationApi).not.toHaveBeenCalled()
    expect(startFlowOperationApi).not.toHaveBeenCalled()
  })

  it('starts backend flows through the main runtime operation tracker', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    startFlowOperationApi.mockResolvedValue({
      operationId: 'operation-flow',
      state: 'queued',
    })
    startStepOperationApi.mockResolvedValue({
      operationId: 'operation-step',
      state: 'queued',
    })

    const runner = useFlowRunner()
    await expect(runner.runAllFlow({ rerun: true })).resolves.toMatchObject({
      operationId: 'operation-flow',
    })
    clearFlowExecutionActiveForWorkspace('/work/demo')
    await expect(runner.runFlow({ rerun: true })).resolves.toMatchObject({
      state: StateEnum.Ongoing,
    })

    expect(startFlowOperationApi).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      rerun: true,
      workspaceHandle: 'workspace-demo',
    })
    expect(startStepOperationApi).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      rerun: true,
      resetDependents: false,
      step: StepEnum.FLOORPLAN,
      workspaceHandle: 'workspace-demo',
    })
    expect(rtl2gdsApi).not.toHaveBeenCalled()
    expect(runStepApi).not.toHaveBeenCalled()
  })

  it('keeps frontend flow and step calls on the design-tool runtime bridge', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/frontend-demo', designTool: 'frontend' }
    rtl2gdsApi.mockResolvedValue({
      response: 'success',
      data: { rerun: false },
      message: [],
    })
    runStepApi.mockResolvedValue({
      response: 'success',
      data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
      message: [],
    })

    const runner = useFlowRunner()
    await runner.runAllFlow()
    clearFlowExecutionActiveForWorkspace('/work/frontend-demo')
    await runner.runFlow({ rerun: true })

    expect(rtl2gdsApi).toHaveBeenCalledWith({
      cmd: 'rtl2gds',
      data: {
        designTool: 'frontend',
        directory: '/work/frontend-demo',
        rerun: false,
        workspaceHandle: 'workspace-demo',
      },
    })
    expect(runStepApi).toHaveBeenCalledWith({
      cmd: 'run_step',
      data: {
        designTool: 'frontend',
        directory: '/work/frontend-demo',
        rerun: true,
        step: StepEnum.FLOORPLAN,
        workspaceHandle: 'workspace-demo',
      },
    })
    expect(startFlowOperationApi).not.toHaveBeenCalled()
    expect(startStepOperationApi).not.toHaveBeenCalled()
  })

  it('does not use the backend rerun snapshot guard for synchronous frontend reruns', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/frontend-demo', designTool: 'frontend' }
    rtl2gdsApi.mockResolvedValue({
      response: 'success',
      data: { rerun: true },
      message: [],
    })

    const runner = useFlowRunner()
    await expect(runner.runAllFlow({ rerun: true })).resolves.toEqual({ rerun: true })

    expect(markHomeRunArtifactResetAwaitingBackendStart).not.toHaveBeenCalled()
    expect(clearHomeRunArtifactResetAwaitingBackendStart).toHaveBeenCalledWith(
      '/work/frontend-demo',
    )
  })

  it('waits for a frontend workspace session to become active before running', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/frontend-demo', designTool: 'frontend' }
    workspaceSession.value = {
      sessionId: 'session-1',
      workspaceId: '',
      state: 'loading',
    }

    const runner = useFlowRunner()
    await expect(runner.runAllFlow()).resolves.toBeNull()

    expect(rtl2gdsApi).not.toHaveBeenCalled()
    expect(startFlowOperationApi).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'No Workspace Open' }),
    )
  })

  it('keeps the backend run lock until the operation waiter reaches a terminal state', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    startFlowOperationApi.mockResolvedValue({
      operationId: 'operation-flow',
      state: 'queued',
    })
    let resolveOperation: (() => void) | undefined
    waitForRuntimeOperation.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveOperation = resolve
        }),
    )

    const runner = useFlowRunner()
    await runner.runAllFlow()
    expect(runner.isRunning.value).toBe(true)
    resolveOperation?.()
    await vi.waitFor(() => expect(runner.isRunning.value).toBe(false))
    expect(invalidateWorkspaceResources).toHaveBeenCalledWith('all')
  })

  it('tracks flow activity independently per workspace', () => {
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
