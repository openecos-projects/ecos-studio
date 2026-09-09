const testState = vi.hoisted(() => ({
  currentProject: null as import('vue').Ref<{ path: string } | null> | null,
  workspaceSession: null as
    | import('vue').Ref<import('./useWorkspaceLifecycle').WorkspaceSession>
    | null,
  readWorkspaceStepConfigurationApi: vi.fn(),
  route: {
    path: '/workspace/floorplan',
    query: { projectRoot: '/projects/gcd' } as Record<string, unknown>,
  },
  showToast: vi.fn(),
  updateWorkspaceStepConfigurationApi: vi.fn(),
}))

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'

vi.mock('vue-router', () => ({ useRoute: () => testState.route }))
vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    currentProject: testState.currentProject,
    showToast: testState.showToast,
    workspaceSession: testState.workspaceSession,
  }),
}))
vi.mock('@/api/workspace', () => ({
  readWorkspaceStepConfigurationApi: testState.readWorkspaceStepConfigurationApi,
  updateWorkspaceStepConfigurationApi: testState.updateWorkspaceStepConfigurationApi,
}))

import { useStepConfigInfo } from './useStepConfigInfo'
import {
  clearFlowExecutionActiveForWorkspace,
  markFlowExecutionActiveForWorkspace,
} from './useFlowRunner'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'

function available(values: Record<string, unknown>, step = 'Floorplan') {
  return {
    parameters: Object.entries(values).map(([param, value]) => ({
      applies: step,
      default: value,
      description: param,
      param,
      type: typeof value,
      value,
    })),
    status: 'available',
    step,
    stepId: step,
    workspaceId: 'engineering-workspace-demo',
    workspaceRevision: 1,
  }
}

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
    lifecycle.activateSession(session.sessionId, {
      workspaceId: 'workspace-demo',
      projectRoot: '/workspace/demo',
      workspaceRevision: 1,
    })
    testState.workspaceSession = lifecycle.session
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.route.path = '/workspace/floorplan'
    testState.showToast.mockReset()
    testState.readWorkspaceStepConfigurationApi.mockReset()
    testState.updateWorkspaceStepConfigurationApi.mockReset()
    testState.updateWorkspaceStepConfigurationApi.mockResolvedValue({
      workspaceRevision: 2,
    })
    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  afterEach(() => scope.stop())

  it('loads an ECC-owned Step configuration object', async () => {
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(
      available({ 'floorplan.ifp.thread_number': 16 }),
    )

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() =>
      expect(result.stepConfigDraft.value).toEqual({ 'floorplan.ifp.thread_number': 16 }),
    )
    expect(result.stepConfigPathResolved.value).toBe('Floorplan parameters')
    expect(result.workspaceRevision.value).toBe(1)
    expect(result.isEmpty.value).toBe(false)
    expect(testState.readWorkspaceStepConfigurationApi).toHaveBeenCalledWith({
      step: 'Floorplan',
      workspaceHandle: 'workspace-demo',
    })
    expect(result.stepConfigParameterDescriptions.value).toEqual({
      'floorplan.ifp.thread_number': 'floorplan.ifp.thread_number',
    })
  })

  it('does not read until the current Workspace Session becomes active', async () => {
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    testState.workspaceSession = lifecycle.session
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue({
      ...available({ 'floorplan.ifp.thread_number': 16 }),
      workspaceRevision: 3,
    })

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => expect(result.loading.value).toBe(false))
    expect(testState.readWorkspaceStepConfigurationApi).not.toHaveBeenCalled()
    expect(result.error.value).toBe('Workspace Session is unavailable.')

    const session = lifecycle.beginSession({ projectRoot: '/workspace/demo' })
    lifecycle.activateSession(session.sessionId, {
      workspaceId: 'workspace-restored',
      projectRoot: '/workspace/demo',
      workspaceRevision: 3,
    })

    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    expect(testState.readWorkspaceStepConfigurationApi).toHaveBeenCalledWith({
      step: 'Floorplan',
      workspaceHandle: 'workspace-restored',
    })
  })

  it('rejects a response from an earlier Workspace Revision', async () => {
    let resolveRequest!: (value: ReturnType<typeof available>) => void
    testState.readWorkspaceStepConfigurationApi.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    const result = scope.run(() => useStepConfigInfo())!
    useWorkspaceLifecycle().updateWorkspaceRevision(2)

    resolveRequest(available({ 'floorplan.ifp.thread_number': 8 }))

    await vi.waitFor(() => expect(result.loading.value).toBe(false))
    expect(result.error.value).toContain('another Workspace Revision')
    expect(result.stepConfigDraft.value).toBeNull()
  })

  it('rejects a response for another Flow Step', async () => {
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(
      available({ 'cts.max_fanout': 32 }, 'CTS'),
    )

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => expect(result.loading.value).toBe(false))
    expect(result.error.value).toContain('another Flow Step')
    expect(result.stepConfigDraft.value).toBeNull()
  })

  it('keeps an unavailable Step reason visible without reporting a Flow failure', async () => {
    testState.route.path = '/workspace/Synthesis'
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue({
      reason: 'step_configuration_unavailable',
      status: 'missing',
      step: 'Synthesis',
      workspaceId: 'workspace-demo',
      workspaceRevision: 1,
    })

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => expect(result.loading.value).toBe(false))
    expect(result.responseKind.value).toBe('warning')
    expect(result.runtimeMessages.value).toEqual([
      'This Flow Step has no configurable parameters.',
    ])
    expect(result.isEmpty.value).toBe(true)
    expect(result.error.value).toBeNull()
  })

  it('keeps every returned Step parameter and reports its count', async () => {
    const parameters = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [`floorplan.parameter_${index}`, index]),
    )
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(available(parameters))

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => expect(result.stepConfigParameterCount.value).toBe(24))
    expect(result.stepConfigDraft.value).toEqual(parameters)
  })

  it('saves Step Parameters through one Product Command and advances Revision', async () => {
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(
      available({ 'floorplan.ifp.thread_number': 16 }),
    )
    const result = scope.run(() => useStepConfigInfo())!
    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    result.stepConfigDraft.value = { 'floorplan.ifp.thread_number': 8 }

    await expect(result.saveStepConfig()).resolves.toBe(true)

    expect(testState.updateWorkspaceStepConfigurationApi).toHaveBeenCalledWith({
      commandId: expect.any(String),
      expectedWorkspaceRevision: 1,
      parameters: { 'floorplan.ifp.thread_number': 8 },
      stepId: 'Floorplan',
      workspaceHandle: 'workspace-demo',
    })
    expect(useWorkspaceLifecycle().session.value.workspaceRevision).toBe(2)
    expect(result.hasStepConfigChanges.value).toBe(false)
  })

  it('keeps Step configuration read-only while execution is active', async () => {
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(
      available({ 'floorplan.ifp.thread_number': 16 }),
    )
    const result = scope.run(() => useStepConfigInfo())!
    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    markFlowExecutionActiveForWorkspace('/workspace/demo')

    await expect(result.saveStepConfig()).resolves.toBe(false)

    expect(result.stepConfigSaveError.value).toContain('read-only')
    expect(testState.updateWorkspaceStepConfigurationApi).not.toHaveBeenCalled()
  })

  it('saves canonical CTS parameters atomically', async () => {
    testState.route.path = '/workspace/CTS'
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(
      available({ 'cts.skew_bound': 0.08, 'cts.max_fanout': 32 }, 'CTS'),
    )

    const result = scope.run(() => useStepConfigInfo())!
    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    result.stepConfigDraft.value = { 'cts.skew_bound': 0.08, 'cts.max_fanout': 24 }

    await expect(result.saveStepConfig()).resolves.toBe(true)

    expect(testState.updateWorkspaceStepConfigurationApi).toHaveBeenCalledWith({
      commandId: expect.any(String),
      expectedWorkspaceRevision: 1,
      parameters: { 'cts.skew_bound': 0.08, 'cts.max_fanout': 24 },
      stepId: 'CTS',
      workspaceHandle: 'workspace-demo',
    })
    expect(useWorkspaceLifecycle().session.value.workspaceRevision).toBe(2)
    expect(result.hasStepConfigChanges.value).toBe(false)
  })

  it('keeps the editor dirty when a Step Parameter update fails', async () => {
    testState.route.path = '/workspace/CTS'
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(
      available({ 'cts.skew_bound': 0.08, 'cts.max_fanout': 32 }, 'CTS'),
    )
    testState.updateWorkspaceStepConfigurationApi.mockRejectedValue(
      new Error('ECC rejected CTS parameters'),
    )

    const result = scope.run(() => useStepConfigInfo())!
    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    result.stepConfigDraft.value = { 'cts.skew_bound': 0.1, 'cts.max_fanout': 24 }

    await expect(result.saveStepConfig()).resolves.toBe(false)

    expect(result.stepConfigSaveError.value).toBe('ECC rejected CTS parameters')
    expect(result.hasStepConfigChanges.value).toBe(true)
    expect(useWorkspaceLifecycle().session.value.workspaceRevision).toBe(1)
    expect(testState.showToast).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Failed to save parameters',
      detail: 'ECC rejected CTS parameters',
      life: 6000,
    })
  })

  it('keeps the editor dirty and toasts an out-of-range Floorplan parameter', async () => {
    testState.readWorkspaceStepConfigurationApi.mockResolvedValue(
      available({ 'floorplan.core_util': 0.7 }),
    )
    testState.updateWorkspaceStepConfigurationApi.mockRejectedValue(
      new Error('value 1.3 out of range [0.01, 1.0] for floorplan.core_util'),
    )

    const result = scope.run(() => useStepConfigInfo())!
    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    result.stepConfigDraft.value = { 'floorplan.core_util': 1.3 }

    await expect(result.saveStepConfig()).resolves.toBe(false)

    expect(result.stepConfigSaveError.value).toBe(
      'value 1.3 out of range [0.01, 1.0] for floorplan.core_util',
    )
    expect(result.hasStepConfigChanges.value).toBe(true)
    expect(useWorkspaceLifecycle().session.value.workspaceRevision).toBe(1)
    expect(testState.showToast).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Failed to save parameters',
      detail: 'value 1.3 out of range [0.01, 1.0] for floorplan.core_util',
      life: 6000,
    })
  })

  it('discards a response after the Workspace session changes', async () => {
    let resolveRequest!: (value: ReturnType<typeof available>) => void
    testState.readWorkspaceStepConfigurationApi.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    const result = scope.run(() => useStepConfigInfo())!
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.beginSession({
      workspaceId: 'workspace-next',
      projectRoot: '/workspace/next',
    })
    lifecycle.closeSession()

    resolveRequest(available({ 'floorplan.ifp.thread_number': 8 }))

    await vi.waitFor(() => expect(result.loading.value).toBe(false))
    expect(result.stepConfigDraft.value).toBeNull()
  })
})
