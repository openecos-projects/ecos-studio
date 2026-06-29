import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  WORKSPACE_INVALIDATION_SCOPES,
  useWorkspaceLifecycle,
  type WorkspaceInvalidationScope,
} from './useWorkspaceLifecycle'

describe('useWorkspaceLifecycle', () => {
  beforeEach(() => {
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.closeSession()
    vi.restoreAllMocks()
  })

  it('creates a fresh validating session for every open or restore attempt', () => {
    const lifecycle = useWorkspaceLifecycle()

    const first = lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })
    const second = lifecycle.beginSession({
      workspaceId: 'workspace-b',
      projectRoot: '/workspace/b',
    })

    expect(first.sessionId).not.toBe(second.sessionId)
    expect(lifecycle.session.value).toMatchObject({
      sessionId: second.sessionId,
      workspaceId: 'workspace-b',
      projectRoot: '/workspace/b',
      state: 'validating',
    })
    expect(lifecycle.isCurrentSession(first.sessionId)).toBe(false)
    expect(lifecycle.isCurrentSession(second.sessionId)).toBe(true)
  })

  it('moves an open session through loading to active without changing its id', () => {
    const lifecycle = useWorkspaceLifecycle()
    const session = lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })

    lifecycle.setSessionLoading(session.sessionId)
    expect(lifecycle.session.value.state).toBe('loading')

    lifecycle.activateSession(session.sessionId, {
      workspaceId: 'workspace-a-canonical',
      projectRoot: '/workspace/a-canonical',
    })

    expect(lifecycle.session.value).toMatchObject({
      sessionId: session.sessionId,
      workspaceId: 'workspace-a-canonical',
      projectRoot: '/workspace/a-canonical',
      state: 'active',
    })
  })

  it('guards async UI writes when a newer session replaces the old one', async () => {
    const lifecycle = useWorkspaceLifecycle()
    const oldSession = lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })
    const writes: string[] = []
    let resolveOldRead: (() => void) | undefined

    const oldWrite = lifecycle.runForSession(oldSession.sessionId, async () => {
      await new Promise<void>((resolve) => {
        resolveOldRead = resolve
      })
      return 'old'
    }).then((result) => {
      if (result) writes.push(result)
      return result
    })

    const newSession = lifecycle.beginSession({
      workspaceId: 'workspace-b',
      projectRoot: '/workspace/b',
    })

    const newWrite = lifecycle.runForSession(newSession.sessionId, async () => 'new')
      .then((result) => {
        if (result) writes.push(result)
        return result
      })

    resolveOldRead?.()
    await expect(oldWrite).resolves.toBeUndefined()
    await expect(newWrite).resolves.toBe('new')
    expect(writes).toEqual(['new'])
  })

  it('runs registered cleanup callbacks exactly once when closing the active session', () => {
    const lifecycle = useWorkspaceLifecycle()
    const session = lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })
    const cleanupA = vi.fn()
    const cleanupB = vi.fn(() => {
      throw new Error('cleanup failed')
    })

    lifecycle.registerCleanup(cleanupA, { sessionId: session.sessionId, label: 'a' })
    lifecycle.registerCleanup(cleanupB, { sessionId: session.sessionId, label: 'b' })

    lifecycle.closeSession()
    lifecycle.closeSession()

    expect(cleanupA).toHaveBeenCalledTimes(1)
    expect(cleanupB).toHaveBeenCalledTimes(1)
    expect(lifecycle.session.value.state).toBe('idle')
    expect(lifecycle.session.value.sessionId).not.toBe(session.sessionId)
  })

  it('revokes registered blob URLs during session cleanup', () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const lifecycle = useWorkspaceLifecycle()
    const session = lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })

    lifecycle.registerBlobUrl('blob:layout', { sessionId: session.sessionId })
    lifecycle.registerBlobUrl('blob:map', { sessionId: session.sessionId })
    lifecycle.revokeBlobUrl('blob:layout')
    lifecycle.closeSession()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:layout')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:map')
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('increments only the requested structured resource versions', () => {
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })
    const initialAll = lifecycle.resourceVersions.value.all
    const initialFlow = lifecycle.resourceVersions.value.flow
    const initialStep = lifecycle.resourceVersions.value.step
    const initialMaps = lifecycle.resourceVersions.value.maps
    const initialLogs = lifecycle.resourceVersions.value.logs

    lifecycle.invalidate(['flow', 'step', 'maps', 'logs'], { reason: 'run_step' })

    expect(lifecycle.resourceVersions.value.flow).toBe(initialFlow + 1)
    expect(lifecycle.resourceVersions.value.step).toBe(initialStep + 1)
    expect(lifecycle.resourceVersions.value.maps).toBe(initialMaps + 1)
    expect(lifecycle.resourceVersions.value.logs).toBe(initialLogs + 1)
    expect(lifecycle.resourceVersions.value.all).toBe(initialAll)
    expect(lifecycle).not.toHaveProperty('stepRefreshCounter')
  })

  it('expands all invalidation to every resource scope', () => {
    const lifecycle = useWorkspaceLifecycle()
    lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })
    const before = { ...lifecycle.resourceVersions.value }

    lifecycle.invalidate('all')

    for (const scope of WORKSPACE_INVALIDATION_SCOPES) {
      expect(lifecycle.resourceVersions.value[scope]).toBe(before[scope] + 1)
    }
  })

  it('supports scoped cleanup handles for stale sessions', () => {
    const lifecycle = useWorkspaceLifecycle()
    const oldSession = lifecycle.beginSession({
      workspaceId: 'workspace-a',
      projectRoot: '/workspace/a',
    })
    const staleCleanup = vi.fn()

    lifecycle.beginSession({
      workspaceId: 'workspace-b',
      projectRoot: '/workspace/b',
    })

    const unregister = lifecycle.registerCleanup(staleCleanup, {
      sessionId: oldSession.sessionId,
      label: 'stale',
    })
    unregister()
    lifecycle.closeSession()

    expect(staleCleanup).not.toHaveBeenCalled()
  })

  it('exposes the expected invalidation scope names', () => {
    const expected: WorkspaceInvalidationScope[] = [
      'home',
      'flow',
      'parameters',
      'step',
      'step-config',
      'maps',
      'logs',
      'all',
    ]

    expect(WORKSPACE_INVALIDATION_SCOPES).toEqual(expected)
  })
})
