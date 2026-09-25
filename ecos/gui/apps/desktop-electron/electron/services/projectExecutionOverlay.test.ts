import { describe, expect, it, vi } from 'vitest'
import type { EccRuntimeOperation } from '@ecos-studio/shared'
import {
  ProjectExecutionOverlay,
  type CommittedProjectWorkspace,
} from './projectExecutionOverlay'

function committedWorkspace(
  overrides: Partial<CommittedProjectWorkspace> = {},
): CommittedProjectWorkspace {
  return {
    engineeringWorkspaceId: '/projects/demo/ws_1',
    projectWorkspaceId: 'ws_1',
    stepStatuses: { Route: 'running' },
    workspaceRevision: 2,
    ...overrides,
  }
}

function activeOperation(
  overrides: Partial<EccRuntimeOperation> = {},
): EccRuntimeOperation {
  return {
    cancelRequested: false,
    createdAt: 1,
    currentStep: 'Route',
    currentTool: 'openroad',
    error: null,
    kind: 'step',
    operationId: 'operation-1',
    origin: 'gui',
    rerun: false,
    result: null,
    state: 'running',
    step: 'Route',
    updatedAt: 2,
    workspaceId: '/projects/demo/ws_1',
    workspaceRevision: 2,
    ...overrides,
  }
}

function overlayFixture(
  operations: EccRuntimeOperation[],
  workspaces: CommittedProjectWorkspace[] = [committedWorkspace()],
) {
  const overlay = new ProjectExecutionOverlay(() => operations)
  overlay.register(11, 'context-1')
  overlay.setCommittedWorkspaces('context-1', workspaces)
  return overlay
}

describe('ProjectExecutionOverlay', () => {
  it('projects an operation whose revision matches the committed snapshot', () => {
    const overlay = overlayFixture([activeOperation()])
    const result = overlay.get(11, 'context-1')
    expect(result).toEqual({
      ok: true,
      projectComparisonContextId: 'context-1',
      generation: 0,
      data: {
        operations: [
          expect.objectContaining({
            operationId: 'operation-1',
            projectWorkspaceId: 'ws_1',
            step: 'Route',
            workspaceRevision: 2,
          }),
        ],
      },
    })
  })

  it('projects an operation ahead of the committed snapshot revision', () => {
    const overlay = overlayFixture([activeOperation({ workspaceRevision: 3 })])
    const result = overlay.get(11, 'context-1')
    expect(result.ok && result.data.operations).toEqual([
      expect.objectContaining({ operationId: 'operation-1', workspaceRevision: 3 }),
    ])
  })

  it('drops an operation behind the committed snapshot revision', () => {
    const overlay = overlayFixture([
      activeOperation({ operationId: 'stale', workspaceRevision: 1 }),
    ])
    const result = overlay.get(11, 'context-1')
    expect(result.ok && result.data.operations).toEqual([])
  })

  it('drops operations for unknown engineering workspaces and inactive states', () => {
    const overlay = overlayFixture([
      activeOperation({ operationId: 'other', workspaceId: 'engineering-other' }),
      activeOperation({ operationId: 'done', state: 'succeeded' }),
    ])
    const result = overlay.get(11, 'context-1')
    expect(result.ok && result.data.operations).toEqual([])
  })

  it('projects an operation without a revision as at-least-committed', () => {
    const overlay = overlayFixture([
      activeOperation({ operationId: 'no-revision', workspaceRevision: undefined }),
    ])
    const result = overlay.get(11, 'context-1')
    expect(result.ok && result.data.operations).toEqual([
      expect.objectContaining({ operationId: 'no-revision', workspaceRevision: 2 }),
    ])
  })

  it('reports a null step when the committed step already completed', () => {
    const overlay = overlayFixture(
      [activeOperation()],
      [committedWorkspace({ stepStatuses: { Route: 'success' } })],
    )
    const result = overlay.get(11, 'context-1')
    expect(result.ok && result.data.operations).toEqual([
      expect.objectContaining({ operationId: 'operation-1', step: null }),
    ])
  })

  it('rejects snapshots for other windows and notifies listeners on invalidate', () => {
    const listener = vi.fn()
    const overlay = overlayFixture([activeOperation()])
    const unsubscribe = overlay.onInvalidated(listener)

    expect(overlay.get(12, 'context-1')).toEqual({ ok: false, code: 'unknown-context' })
    expect(overlay.get(11, 'unknown')).toEqual({ ok: false, code: 'unknown-context' })

    overlay.invalidate()
    expect(listener).toHaveBeenCalledWith(11, {
      generation: 1,
      projectComparisonContextId: 'context-1',
    })

    unsubscribe()
    overlay.invalidate()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
