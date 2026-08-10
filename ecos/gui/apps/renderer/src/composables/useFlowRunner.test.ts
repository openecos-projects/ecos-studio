import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StateEnum, StepEnum } from '@/api/type'

const {
  ensureDesktopRuntime,
  ensureApiReady,
  showToast,
  invalidateWorkspaceResources,
  resourceVersions,
  workspaceSession,
  startFlowOperationApi,
  startStepOperationApi,
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
      workspaceId: 'workspace-demo',
    },
  },
  startFlowOperationApi: vi.fn(),
  startStepOperationApi: vi.fn(),
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
  startFlowOperationApi,
  startStepOperationApi,
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
  resetFlowExecutionState,
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
      workspaceId: 'workspace-demo',
    }
    startFlowOperationApi.mockReset()
    startStepOperationApi.mockReset()
    requestHomeRunArtifactReset.mockReset()
    markHomeRunArtifactResetAwaitingBackendStart.mockReset()
    clearHomeRunArtifactResetAwaitingBackendStart.mockReset()
    resetFlowExecutionState()
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
    expect(startStepOperationApi).not.toHaveBeenCalled()
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
    expect(startFlowOperationApi).not.toHaveBeenCalled()
    expect(ensureApiReady).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('starts a full flow as an asynchronous runtime operation', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    startFlowOperationApi.mockResolvedValue({ operationId: 'operation-1', state: 'queued' })

    const { runAllFlow, isRunning } = useFlowRunner()

    await expect(runAllFlow()).resolves.toMatchObject({ operationId: 'operation-1' })
    expect(startFlowOperationApi).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      rerun: false,
      workspaceHandle: 'workspace-demo',
    })
    expect(isRunning.value).toBe(true)
    expect(invalidateWorkspaceResources).not.toHaveBeenCalled()
  })

  it('passes rerun=true when starting a full flow operation', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    startFlowOperationApi.mockResolvedValue({ operationId: 'operation-1', state: 'queued' })

    const { runAllFlow } = useFlowRunner()

    await runAllFlow({ rerun: true })
    expect(markHomeRunArtifactResetAwaitingBackendStart).toHaveBeenCalledWith('/work/demo')
    expect(startFlowOperationApi).toHaveBeenCalledWith(
      expect.objectContaining({ rerun: true }),
    )
  })

  it('does not mark the full flow running when the runtime bridge is unavailable', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    ensureApiReady.mockResolvedValue(false)

    const { runAllFlow, isRunning } = useFlowRunner()

    await expect(runAllFlow()).resolves.toBeNull()

    expect(ensureApiReady).toHaveBeenCalledTimes(1)
    expect(startFlowOperationApi).not.toHaveBeenCalled()
    expect(isRunning.value).toBe(false)
  })

  it('starts the active step through the asynchronous runtime operation API', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    startStepOperationApi.mockResolvedValue({ operationId: 'operation-1', state: 'queued' })

    const { runFlow } = useFlowRunner()

    await runFlow()

    expect(startStepOperationApi).toHaveBeenCalledWith({
      idempotencyKey: expect.any(String),
      rerun: false,
      resetDependents: false,
      step: StepEnum.FLOORPLAN,
      workspaceHandle: 'workspace-demo',
    })
  })

  it('passes rerun=true to the single step API when requested', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    startStepOperationApi.mockResolvedValue({ operationId: 'operation-1', state: 'queued' })

    const { runFlow } = useFlowRunner()

    await runFlow({ rerun: true })

    expect(startStepOperationApi).toHaveBeenCalledWith(
      expect.objectContaining({
        rerun: true,
        resetDependents: false,
        step: StepEnum.FLOORPLAN,
      }),
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
