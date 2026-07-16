import { describe, expect, it } from 'vitest'

import {
  WorkspaceSessionNotFoundError,
  WorkspaceSessionRegistry,
} from './workspaceSessions'

describe('WorkspaceSessionRegistry', () => {
  it('creates a GUI handle only after a workspace is activated', () => {
    const registry = new WorkspaceSessionRegistry({
      idProvider: () => 'workspace-handle-1',
    })

    const session = registry.activate('/work/demo', 'workspace-1')

    expect(session).toEqual({
      directory: '/work/demo',
      eccWorkspaceId: 'workspace-1',
      workspaceHandle: 'workspace-handle-1',
    })
  })

  it('keeps previous sessions addressable after another workspace is activated', () => {
    const handles = ['workspace-handle-1', 'workspace-handle-2']
    const registry = new WorkspaceSessionRegistry({
      idProvider: () => handles.shift()!,
    })
    const first = registry.activate('/work/first', 'workspace-1')
    const second = registry.activate('/work/second', 'workspace-2')

    expect(registry.require(first.workspaceHandle)).toEqual(first)
    expect(registry.active).toEqual(second)
  })

  it('keeps the GUI handle stable when rebinding the active ECC workspace id', () => {
    const registry = new WorkspaceSessionRegistry({
      idProvider: () => 'workspace-handle-1',
    })
    const session = registry.activate('/work/demo', 'workspace-1')

    registry.clearEccWorkspaceIds()
    registry.rebind(session.workspaceHandle, 'workspace-2')

    expect(registry.require(session.workspaceHandle)).toEqual({
      directory: '/work/demo',
      eccWorkspaceId: 'workspace-2',
      workspaceHandle: 'workspace-handle-1',
    })
  })

  it('rebinds only the requested session after ECC workspace ids are cleared', () => {
    const handles = ['workspace-handle-1', 'workspace-handle-2']
    const registry = new WorkspaceSessionRegistry({
      idProvider: () => handles.shift()!,
    })
    const first = registry.activate('/work/first', 'workspace-1')
    const second = registry.activate('/work/second', 'workspace-2')

    registry.clearEccWorkspaceIds()
    registry.rebind(first.workspaceHandle, 'workspace-3')

    expect(registry.require(first.workspaceHandle).eccWorkspaceId).toBe('workspace-3')
    expect(registry.require(second.workspaceHandle).eccWorkspaceId).toBeNull()
    expect(registry.active?.workspaceHandle).toBe(second.workspaceHandle)
  })

  it('throws when resolving an unknown handle', () => {
    const registry = new WorkspaceSessionRegistry()

    expect(() => registry.require('missing')).toThrow(WorkspaceSessionNotFoundError)
  })

  it('closes the active session', () => {
    const registry = new WorkspaceSessionRegistry({
      idProvider: () => 'workspace-handle-1',
    })
    const session = registry.activate('/work/demo', 'workspace-1')

    registry.close(session.workspaceHandle)

    expect(registry.active).toBeNull()
  })

  it('restores the newest remaining session when the active session closes', () => {
    const handles = ['workspace-handle-1', 'workspace-handle-2']
    const registry = new WorkspaceSessionRegistry({
      idProvider: () => handles.shift()!,
    })
    const first = registry.activate('/work/first', 'workspace-1')
    const second = registry.activate('/work/second', 'workspace-2')

    registry.close(second.workspaceHandle)

    expect(registry.active).toEqual(first)
  })

  it('detects another GUI handle that references the same ECC workspace', () => {
    const handles = ['workspace-handle-1', 'workspace-handle-2']
    const registry = new WorkspaceSessionRegistry({
      idProvider: () => handles.shift()!,
    })
    const first = registry.activate('/work/demo', 'workspace-shared')
    const second = registry.activate('/work/demo', 'workspace-shared')

    expect(
      registry.hasOtherEccWorkspaceReference(first.workspaceHandle, 'workspace-shared'),
    ).toBe(true)

    registry.close(second.workspaceHandle)

    expect(
      registry.hasOtherEccWorkspaceReference(first.workspaceHandle, 'workspace-shared'),
    ).toBe(false)
  })
})
