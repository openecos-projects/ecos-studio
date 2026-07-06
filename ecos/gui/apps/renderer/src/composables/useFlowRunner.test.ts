import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { CMDEnum, StateEnum, StepEnum } from '@/api/type'

const testState = vi.hoisted(() => ({
  runtimeEvents: null as import('vue').Ref<unknown[]> | null,
}))

const {
  ensureDesktopRuntime,
  ensureApiReady,
  showToast,
  invalidateWorkspaceResources,
  resourceVersions,
  workspaceSession,
  cancelFlowApi,
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
  cancelFlowApi: vi.fn(),
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
    runtimeEvents: testState.runtimeEvents,
    workspaceSession,
  }),
}))

vi.mock('@/api/flow', () => ({
  cancelFlowApi,
  runStepApi,
  rtl2gdsApi,
}))

vi.mock('./homeRunArtifacts', () => ({
  requestHomeRunArtifactReset,
  markHomeRunArtifactResetAwaitingBackendStart,
  clearHomeRunArtifactResetAwaitingBackendStart,
}))

import {
  clearFlowCancellationPendingForWorkspace,
  clearFlowExecutionActiveForWorkspace,
  flowExecutionActive,
  isFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
  useFlowRunner,
} from './useFlowRunner'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, reject, resolve }
}

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
    testState.runtimeEvents = ref([])
    workspaceSession.value = {
      sessionId: 'session-1',
    }
    cancelFlowApi.mockReset()
    runStepApi.mockReset()
    rtl2gdsApi.mockReset()
    requestHomeRunArtifactReset.mockReset()
    markHomeRunArtifactResetAwaitingBackendStart.mockReset()
    clearHomeRunArtifactResetAwaitingBackendStart.mockReset()
    flowExecutionActive.value = false
    clearFlowExecutionActiveForWorkspace('/work/a')
    clearFlowExecutionActiveForWorkspace('/work/b')
    clearFlowExecutionActiveForWorkspace('/work/demo')
    clearFlowCancellationPendingForWorkspace('/work/a')
    clearFlowCancellationPendingForWorkspace('/work/b')
    clearFlowCancellationPendingForWorkspace('/work/demo')
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

  it('cancels the active workspace flow through the desktop runtime', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    markFlowExecutionActiveForWorkspace('/work/demo', CMDEnum.rtl2gds)
    cancelFlowApi.mockResolvedValue({
      cmd: 'rtl2gds',
      data: { directory: '/work/demo' },
      message: ['Cancellation requested for rtl2gds.'],
      ok: false,
      response: 'cancelled',
    })

    const { cancelRunningFlow, isCancelling, isRunning, isStopping } = useFlowRunner()

    expect(isRunning.value).toBe(true)
    expect(isStopping.value).toBe(false)

    await expect(cancelRunningFlow()).resolves.toBe(true)
    expect(isCancelling.value).toBe(false)
    expect(isRunning.value).toBe(true)
    expect(isStopping.value).toBe(true)
    expect(flowExecutionActive.value).toBe(true)
    expect(cancelFlowApi).toHaveBeenCalledWith({
      cmd: 'rtl2gds',
      data: {
        directory: '/work/demo',
      },
    })
    expect(showToast).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Flow Stopped',
      detail: 'Cancellation requested for rtl2gds.',
      life: 5000,
    })
  })

  it('shows stopping for a cancellation accepted without a local run marker until the runtime exits', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    cancelFlowApi.mockResolvedValue({
      cmd: 'rtl2gds',
      data: { directory: '/work/demo' },
      message: ['Cancellation requested for rtl2gds.'],
      ok: false,
      response: 'cancelled',
    })

    const { cancelRunningFlow, isRunning, isStopping } = useFlowRunner()

    expect(isRunning.value).toBe(false)
    expect(isStopping.value).toBe(false)

    await expect(cancelRunningFlow()).resolves.toBe(true)

    expect(isRunning.value).toBe(false)
    expect(isStopping.value).toBe(true)

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/work/demo',
          type: 'cancelled',
        },
        message: ['Cancelled rtl2gds.'],
        response: 'cancelled',
      },
    ]
    await nextTick()

    expect(isStopping.value).toBe(false)
  })

  it('does not re-enter stopping when the runtime cancelled event arrives before the cancel response', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    const deferredCancel = createDeferred<{
      cmd: string
      data: { directory: string }
      message: string[]
      ok: boolean
      response: string
    }>()
    cancelFlowApi.mockReturnValue(deferredCancel.promise)

    const { cancelRunningFlow, isStopping } = useFlowRunner()
    const cancelPromise = cancelRunningFlow()

    await nextTick()
    expect(isStopping.value).toBe(true)

    testState.runtimeEvents!.value = [
      {
        cmd: 'notify',
        data: {
          cmd: 'rtl2gds',
          directory: '/work/demo',
          type: 'cancelled',
        },
        message: ['Cancelled rtl2gds.'],
        response: 'cancelled',
      },
    ]
    await nextTick()
    expect(isStopping.value).toBe(false)

    deferredCancel.resolve({
      cmd: 'rtl2gds',
      data: { directory: '/work/demo' },
      message: ['Cancellation requested for rtl2gds.'],
      ok: false,
      response: 'cancelled',
    })

    await expect(cancelPromise).resolves.toBe(true)
    expect(isStopping.value).toBe(false)
  })

  it('treats a no-active cancellation warning as stale flow UI cleanup', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    markFlowExecutionActiveForWorkspace('/work/demo', CMDEnum.rtl2gds)
    cancelFlowApi.mockResolvedValue({
      cmd: 'rtl2gds',
      data: { directory: '/work/demo' },
      message: ['No active ECC command is running for /work/demo.'],
      ok: true,
      response: 'warning',
    })

    const { cancelRunningFlow, isRunning, isStopping } = useFlowRunner()

    expect(isRunning.value).toBe(true)
    await expect(cancelRunningFlow()).resolves.toBe(true)

    expect(isRunning.value).toBe(false)
    expect(isStopping.value).toBe(false)
    expect(flowExecutionActive.value).toBe(false)
    expect(showToast).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Stop Flow',
      detail: 'No active ECC command is running for /work/demo.',
      life: 5000,
    })
  })

  it('does not force a fallback command when no local flow command is known', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    cancelFlowApi.mockResolvedValue({
      cmd: 'run_step',
      data: { directory: '/work/demo' },
      message: ['Cancellation requested for run_step.'],
      ok: false,
      response: 'cancelled',
    })

    const { cancelRunningFlow } = useFlowRunner()

    await expect(cancelRunningFlow()).resolves.toBe(true)

    expect(cancelFlowApi).toHaveBeenCalledWith({
      data: {
        directory: '/work/demo',
      },
    })
  })

  it('cancels an active single-step run with the run_step command', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    let resolveRunStep:
      | ((value: {
          data: { state: StateEnum; step: StepEnum }
          message: string[]
          response: string
        }) => void)
      | undefined
    runStepApi.mockReturnValue(
      new Promise((resolve) => {
        resolveRunStep = resolve
      }),
    )
    cancelFlowApi.mockResolvedValue({
      cmd: 'run_step',
      data: { directory: '/work/demo' },
      message: ['Cancellation requested for run_step.'],
      ok: false,
      response: 'cancelled',
    })

    const { cancelRunningFlow, runFlow } = useFlowRunner()
    const runPromise = runFlow()

    await vi.waitFor(() => {
      expect(runStepApi).toHaveBeenCalledTimes(1)
    })
    await expect(cancelRunningFlow()).resolves.toBe(true)

    expect(cancelFlowApi).toHaveBeenCalledWith({
      cmd: 'run_step',
      data: {
        directory: '/work/demo',
      },
    })

    resolveRunStep?.({
      data: { state: StateEnum.Success, step: StepEnum.FLOORPLAN },
      message: ['done'],
      response: 'success',
    })
    await runPromise
  })

  it('shows one stopped toast when a cancelled full flow settles after the stop request', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    let resolveRunAll:
      | ((value: {
          data: Record<string, unknown>
          message: string[]
          response: string
        }) => void)
      | undefined
    rtl2gdsApi.mockReturnValue(
      new Promise((resolve) => {
        resolveRunAll = resolve
      }),
    )
    cancelFlowApi.mockResolvedValue({
      cmd: 'rtl2gds',
      data: { directory: '/work/demo' },
      message: ['Cancellation requested for rtl2gds.'],
      ok: false,
      response: 'cancelled',
    })

    const { cancelRunningFlow, isRunning, isStopping, runAllFlow } = useFlowRunner()
    const runPromise = runAllFlow()

    await vi.waitFor(() => {
      expect(rtl2gdsApi).toHaveBeenCalledTimes(1)
    })
    await expect(cancelRunningFlow()).resolves.toBe(true)
    expect(isRunning.value).toBe(true)
    expect(isStopping.value).toBe(true)
    resolveRunAll?.({
      data: {},
      message: ['Cancelled rtl2gds.'],
      response: 'cancelled',
    })
    await runPromise
    expect(isRunning.value).toBe(false)
    expect(isStopping.value).toBe(false)

    const stoppedToasts = showToast.mock.calls.filter(([toast]) =>
      String(toast.summary).includes('Stopped'),
    )
    expect(stoppedToasts).toHaveLength(1)
    expect(stoppedToasts[0]?.[0]).toMatchObject({
      summary: 'Flow Stopped',
    })
  })

  it('clears a full-flow rerun after a duplicate startup marker is observed', async () => {
    ensureDesktopRuntime.mockReturnValue(true)
    currentProject.value = { path: '/work/demo' }
    let resolveRunAll:
      | ((value: {
          data: Record<string, unknown>
          message: string[]
          response: string
        }) => void)
      | undefined
    rtl2gdsApi.mockReturnValue(
      new Promise((resolve) => {
        resolveRunAll = resolve
      }),
    )

    const { isRunning, runAllFlow } = useFlowRunner()
    const runPromise = runAllFlow({ rerun: true })

    await vi.waitFor(() => {
      expect(rtl2gdsApi).toHaveBeenCalledTimes(1)
    })
    expect(isRunning.value).toBe(true)

    markFlowExecutionActiveForWorkspace('/work/demo', CMDEnum.rtl2gds)

    resolveRunAll?.({
      data: {},
      message: ['Cancelled rtl2gds.'],
      response: 'cancelled',
    })
    await runPromise

    expect(isRunning.value).toBe(false)
    expect(flowExecutionActive.value).toBe(false)
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

    expect(invalidateWorkspaceResources).toHaveBeenCalledWith(['home', 'parameters'], {
      sessionId: 'session-1',
    })
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

    expect(invalidateWorkspaceResources).toHaveBeenCalledWith(['home', 'parameters'], {
      sessionId: 'session-1',
    })
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
    let resolveRunStep:
      | ((value: {
          data: { state: StateEnum; step: StepEnum }
          message: string[]
          response: string
        }) => void)
      | undefined
    runStepApi.mockReturnValue(
      new Promise((resolve) => {
        resolveRunStep = resolve
      }),
    )

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

    expect(invalidateWorkspaceResources).toHaveBeenCalledWith(['home', 'parameters'], {
      sessionId: 'session-a',
    })
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

  it('does not let an old flow finalizer clear a newer workspace run', () => {
    const staleToken = markFlowExecutionActiveForWorkspace('/work/demo')

    clearFlowExecutionActiveForWorkspace('/work/demo')
    const newerToken = markFlowExecutionActiveForWorkspace('/work/demo')
    clearFlowExecutionActiveForWorkspace('/work/demo', staleToken)

    expect(isFlowExecutionActiveForWorkspace('/work/demo')).toBe(true)
    expect(flowExecutionActive.value).toBe(true)

    clearFlowExecutionActiveForWorkspace('/work/demo', newerToken)

    expect(isFlowExecutionActiveForWorkspace('/work/demo')).toBe(false)
    expect(flowExecutionActive.value).toBe(false)
  })
})
