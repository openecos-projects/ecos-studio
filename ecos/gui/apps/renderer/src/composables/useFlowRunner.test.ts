import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StateEnum, StepEnum } from '@/api/type'

const {
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
  requestStalenessConfirmation,
} = vi.hoisted(() => ({
  ensureApiReady: vi.fn(() => Promise.resolve(true)),
  showToast: vi.fn(),
  invalidateWorkspaceResources: vi.fn(),
  resourceVersions: {
    value: {
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
      workspaceRevision: 1,
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
  requestStalenessConfirmation: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { step: StepEnum.FLOORPLAN } }),
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

vi.mock('./useResourceStalenessGuard', () => ({
  useResourceStalenessGuard: () => ({ requestStalenessConfirmation }),
}))

import {
  clearFlowExecutionActiveForWorkspace,
  flowExecutionActive,
  markFlowExecutionActiveForWorkspace,
  resetFlowExecutionState,
  useFlowRunner,
} from './useFlowRunner'
import {
  setBackendFlowProjectionReady,
  setBackendFlowProjectionUnknown,
} from './flowExecutionState'

describe('useFlowRunner desktop and design-tool routing', () => {
  beforeEach(() => {
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
    requestStalenessConfirmation.mockReset()
    workspaceSession.value = {
      sessionId: 'session-1',
      workspaceId: 'workspace-demo',
      workspaceRevision: 1,
      state: undefined,
    }
    resourceVersions.value = {
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

  it('starts backend flows through the main runtime operation tracker', async () => {
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
      expectedWorkspaceRevision: 1,
      idempotencyKey: expect.any(String),
      rerun: true,
      workspaceHandle: 'workspace-demo',
    })
    expect(startStepOperationApi).toHaveBeenCalledWith({
      expectedWorkspaceRevision: 1,
      idempotencyKey: expect.any(String),
      rerun: true,
      resetDependents: false,
      step: StepEnum.FLOORPLAN,
      workspaceHandle: 'workspace-demo',
    })
    expect(waitForRuntimeOperation).toHaveBeenCalledWith('operation-flow', {
      workspaceHandle: 'workspace-demo',
    })
    expect(waitForRuntimeOperation).toHaveBeenCalledWith('operation-step', {
      workspaceHandle: 'workspace-demo',
    })
    expect(rtl2gdsApi).not.toHaveBeenCalled()
    expect(runStepApi).not.toHaveBeenCalled()
  })

  it('keeps frontend flow and step calls on the design-tool runtime bridge', async () => {
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
        allowStaleResources: false,
        designTool: 'frontend',
        directory: '/work/frontend-demo',
        rerun: false,
        workspaceHandle: 'workspace-demo',
      },
    })
    expect(runStepApi).toHaveBeenCalledWith({
      cmd: 'run_step',
      data: {
        allowStaleResources: false,
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
    currentProject.value = { path: '/work/frontend-demo', designTool: 'frontend' }
    workspaceSession.value = {
      sessionId: 'session-1',
      workspaceId: '',
      workspaceRevision: 1,
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
    expect(invalidateWorkspaceResources).toHaveBeenCalledWith([
      'flow',
      'step',
      'maps',
      'logs',
    ])
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

  it('keeps the backend run control non-startable while its projection is unknown', () => {
    currentProject.value = { designTool: 'backend', path: '/work/demo' }
    const runner = useFlowRunner()
    expect(runner.isRunning.value).toBe(false)

    // A pending or failed recovery marks only the recovering Workspace unknown.
    setBackendFlowProjectionUnknown(['/work/demo'])
    expect(runner.isRunning.value).toBe(true)

    setBackendFlowProjectionUnknown(['/work/other'])
    expect(runner.isRunning.value).toBe(false)

    // A failed projection request must not silently fall back to idle.
    setBackendFlowProjectionUnknown([])
    setBackendFlowProjectionReady(false)
    expect(runner.isRunning.value).toBe(true)
  })

  it('keeps the frontend run control independent of backend projection state', () => {
    currentProject.value = { designTool: 'frontend', path: '/work/demo' }
    const runner = useFlowRunner()

    setBackendFlowProjectionUnknown(['/work/demo'])
    setBackendFlowProjectionReady(false)

    expect(runner.isRunning.value).toBe(false)
  })

  it('converts a backend RESOURCE_UPDATE_AVAILABLE failure into a confirmation request', async () => {
    currentProject.value = { path: '/work/demo' }
    const staleItem = {
      id: 'tool:yosys',
      display_name: 'Yosys',
      installed_version: '0.61',
      latest_version: '0.62',
      update_kind: 'version' as const,
    }
    startFlowOperationApi.mockRejectedValueOnce(
      Object.assign(new Error('Resource updates are available for: Yosys'), {
        code: 'RESOURCE_UPDATE_AVAILABLE',
        details: { resources: [staleItem] },
      }),
    )

    const runner = useFlowRunner()
    await expect(runner.runAllFlow()).resolves.toBeNull()

    expect(requestStalenessConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: [staleItem],
        retry: expect.any(Function),
        runLabel: 'full flow',
      }),
    )
    expect(runner.isRunning.value).toBe(false)
    expect(runner.state.value).toBe(StateEnum.Invalid)
    expect(showToast.mock.calls.some((call) => call[0]?.severity === 'error')).toBe(false)
  })

  it('re-runs an intercepted backend flow with the allow-stale decision', async () => {
    currentProject.value = { path: '/work/demo' }
    startFlowOperationApi
      .mockRejectedValueOnce(
        Object.assign(new Error('Resource updates are available for: Yosys'), {
          code: 'RESOURCE_UPDATE_AVAILABLE',
        }),
      )
      .mockResolvedValueOnce({
        operationId: 'operation-flow',
        state: 'queued',
      })

    const runner = useFlowRunner()
    await runner.runAllFlow()
    const request = requestStalenessConfirmation.mock.calls[0]?.[0]
    expect(request).toBeDefined()

    await request.retry(true)

    expect(startFlowOperationApi).toHaveBeenCalledTimes(2)
    expect(startFlowOperationApi).toHaveBeenLastCalledWith(
      expect.objectContaining({ allowStaleResources: true }),
    )
    clearFlowExecutionActiveForWorkspace('/work/demo')
  })

  it('converts a frontend step RESOURCE_UPDATE_AVAILABLE failure into a confirmation request', async () => {
    currentProject.value = { path: '/work/frontend-demo', designTool: 'frontend' }
    runStepApi.mockRejectedValueOnce(
      Object.assign(new Error('Resource updates are available for: Yosys'), {
        code: 'RESOURCE_UPDATE_AVAILABLE',
        details: { resources: [] },
      }),
    )

    const runner = useFlowRunner()
    await expect(runner.runFlow()).resolves.toBeNull()

    expect(requestStalenessConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        resources: [],
        retry: expect.any(Function),
        runLabel: 'Floorplan step',
      }),
    )
    expect(runner.isRunning.value).toBe(false)
    expect(runner.state.value).toBe(StateEnum.Invalid)
    expect(showToast.mock.calls.some((call) => call[0]?.severity === 'error')).toBe(false)
  })

  it('passes the allow-stale decision through a frontend step retry', async () => {
    currentProject.value = { path: '/work/frontend-demo', designTool: 'frontend' }
    runStepApi
      .mockRejectedValueOnce(
        Object.assign(new Error('Resource updates are available for: Yosys'), {
          code: 'RESOURCE_UPDATE_AVAILABLE',
        }),
      )
      .mockResolvedValueOnce({
        response: 'success',
        data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
        message: [],
      })

    const runner = useFlowRunner()
    await runner.runFlow()
    const request = requestStalenessConfirmation.mock.calls[0]?.[0]
    expect(request).toBeDefined()

    await request.retry(true)

    expect(runStepApi).toHaveBeenCalledTimes(2)
    expect(runStepApi).toHaveBeenLastCalledWith({
      cmd: 'run_step',
      data: expect.objectContaining({
        allowStaleResources: true,
        step: StepEnum.FLOORPLAN,
      }),
    })
  })

  it('surfaces non-staleness failures as before', async () => {
    currentProject.value = { path: '/work/demo' }
    startFlowOperationApi.mockRejectedValueOnce(new Error('sidecar unavailable'))

    const runner = useFlowRunner()
    await runner.runAllFlow()

    expect(requestStalenessConfirmation).not.toHaveBeenCalled()
    expect(showToast.mock.calls.some((call) => call[0]?.severity === 'error')).toBe(true)
  })
})
