const testState = vi.hoisted(() => ({
  currentProject: null as import('vue').Ref<{ path: string } | null> | null,
  readWorkspaceStepConfiguration: vi.fn(),
  route: {
    path: '/workspace/floorplan',
    query: { projectRoot: '/projects/gcd' } as Record<string, unknown>,
  },
  updateWorkspaceStepConfigurationApi: vi.fn(),
}))

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'

vi.mock('vue-router', () => ({ useRoute: () => testState.route }))
vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({ currentProject: testState.currentProject }),
}))
vi.mock('@/api/workspace', () => ({
  updateWorkspaceStepConfigurationApi: testState.updateWorkspaceStepConfigurationApi,
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    projectManagement: {
      readWorkspaceStepConfiguration: testState.readWorkspaceStepConfiguration,
    },
  }),
}))
vi.mock('@/utils/projectManifestRegistration', () => ({
  resolveProjectRouteContextForWorkspace: vi.fn().mockResolvedValue(null),
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
    testState.currentProject = ref({ path: '/workspace/demo' })
    testState.route.path = '/workspace/floorplan'
    testState.readWorkspaceStepConfiguration.mockReset()
    testState.updateWorkspaceStepConfigurationApi.mockReset()
    testState.updateWorkspaceStepConfigurationApi.mockResolvedValue({
      workspaceRevision: 2,
    })
    clearFlowExecutionActiveForWorkspace('/workspace/demo')
  })

  afterEach(() => scope.stop())

  it('loads an ECC-owned Step configuration object', async () => {
    testState.readWorkspaceStepConfiguration.mockResolvedValue(
      available({ 'floorplan.ifp.thread_number': 16 }),
    )

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() =>
      expect(result.stepConfigDraft.value).toEqual({ 'floorplan.ifp.thread_number': 16 }),
    )
    expect(result.stepConfigPathResolved.value).toBe('Floorplan parameters')
    expect(result.workspaceRevision.value).toBe(1)
    expect(result.isEmpty.value).toBe(false)
    expect(testState.readWorkspaceStepConfiguration).toHaveBeenCalledWith({
      projectRoot: '/projects/gcd',
      step: 'Floorplan',
      workspacePath: '/workspace/demo',
    })
    expect(result.stepConfigParameterDescriptions.value).toEqual({
      'floorplan.ifp.thread_number': 'floorplan.ifp.thread_number',
    })
  })

  it('keeps every returned Step parameter and reports its count', async () => {
    const parameters = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => [`floorplan.parameter_${index}`, index]),
    )
    testState.readWorkspaceStepConfiguration.mockResolvedValue(available(parameters))

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() => expect(result.stepConfigParameterCount.value).toBe(24))
    expect(result.stepConfigDraft.value).toEqual(parameters)
  })

  it('saves Step Parameters through one Product Command and advances Revision', async () => {
    testState.readWorkspaceStepConfiguration.mockResolvedValue(
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
    testState.readWorkspaceStepConfiguration.mockResolvedValue(
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
    testState.readWorkspaceStepConfiguration.mockResolvedValue(
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
    testState.readWorkspaceStepConfiguration.mockResolvedValue(
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
  })

  it('discards a response after the Workspace session changes', async () => {
    let resolveRequest!: (value: ReturnType<typeof available>) => void
    testState.readWorkspaceStepConfiguration.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )
    const result = scope.run(() => useStepConfigInfo())!
    const lifecycle = useWorkspaceLifecycle()
    const next = lifecycle.beginSession({
      workspaceId: 'workspace-next',
      projectRoot: '/workspace/next',
    })
    lifecycle.activateSession(next.sessionId)

    resolveRequest(available({ 'floorplan.ifp.thread_number': 8 }))

    await vi.waitFor(() => expect(result.loading.value).toBe(false))
    expect(result.stepConfigDraft.value).toBeNull()
  })
})
