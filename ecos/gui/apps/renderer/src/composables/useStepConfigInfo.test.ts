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

function available(options: Record<string, unknown>) {
  return {
    options,
    status: 'available',
    step: 'Floorplan',
    stepId: 'Floorplan',
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
      available({ ifp: { thread_number: 16 } }),
    )

    const result = scope.run(() => useStepConfigInfo())!

    await vi.waitFor(() =>
      expect(result.stepConfigDraft.value).toEqual({ ifp: { thread_number: 16 } }),
    )
    expect(result.stepConfigPathResolved.value).toBe('Floorplan options')
    expect(result.workspaceRevision.value).toBe(1)
    expect(result.isEmpty.value).toBe(false)
    expect(testState.readWorkspaceStepConfiguration).toHaveBeenCalledWith({
      projectRoot: '/projects/gcd',
      step: 'Floorplan',
      workspacePath: '/workspace/demo',
    })
  })

  it('saves Step Options through one Product Command and advances Revision', async () => {
    testState.readWorkspaceStepConfiguration.mockResolvedValue(
      available({ ifp: { thread_number: 16 } }),
    )
    const result = scope.run(() => useStepConfigInfo())!
    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    result.stepConfigDraft.value = { ifp: { thread_number: 8 } }

    await expect(result.saveStepConfig()).resolves.toBe(true)

    expect(testState.updateWorkspaceStepConfigurationApi).toHaveBeenCalledWith({
      commandId: expect.any(String),
      expectedWorkspaceRevision: 1,
      options: { ifp: { thread_number: 8 } },
      stepId: 'Floorplan',
      workspaceHandle: 'workspace-demo',
    })
    expect(useWorkspaceLifecycle().session.value.workspaceRevision).toBe(2)
    expect(result.hasStepConfigChanges.value).toBe(false)
  })

  it('keeps Step configuration read-only while execution is active', async () => {
    testState.readWorkspaceStepConfiguration.mockResolvedValue(
      available({ ifp: { thread_number: 16 } }),
    )
    const result = scope.run(() => useStepConfigInfo())!
    await vi.waitFor(() => expect(result.stepConfigDraft.value).not.toBeNull())
    markFlowExecutionActiveForWorkspace('/workspace/demo')

    await expect(result.saveStepConfig()).resolves.toBe(false)

    expect(result.stepConfigSaveError.value).toContain('read-only')
    expect(testState.updateWorkspaceStepConfigurationApi).not.toHaveBeenCalled()
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

    resolveRequest(available({ ifp: { thread_number: 8 } }))

    await vi.waitFor(() => expect(result.loading.value).toBe(false))
    expect(result.stepConfigDraft.value).toBeNull()
  })
})
