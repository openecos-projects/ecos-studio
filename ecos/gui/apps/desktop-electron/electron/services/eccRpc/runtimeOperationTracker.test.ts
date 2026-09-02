import { describe, expect, it } from 'vitest'
import type { EccRuntimeProtocolPayload } from '@ecos-studio/shared'
import { RuntimeOperationTracker } from './runtimeOperationTracker'

function operationEvent(
  state: 'queued' | 'running' | 'succeeded',
  overrides: Partial<EccRuntimeProtocolPayload> = {},
): EccRuntimeProtocolPayload {
  return {
    eventId: `operation-1:${state}`,
    kind: 'step',
    operationId: 'operation-1',
    origin: 'gui',
    payload: {
      cancelRequested: false,
      state,
      step: 'Route',
      workspaceRevision: 7,
    },
    sequence: 1,
    timestamp: 10,
    type: 'operation.changed',
    workspaceId: 'engineering-ws-1',
    ...overrides,
  }
}

describe('RuntimeOperationTracker active operations', () => {
  it('retains queued, running, and cancellation-requested operation facts', () => {
    const tracker = new RuntimeOperationTracker()

    tracker.track(operationEvent('queued'))
    expect(tracker.activeOperations()).toEqual([
      expect.objectContaining({
        operationId: 'operation-1',
        state: 'queued',
        workspaceId: 'engineering-ws-1',
        workspaceRevision: 7,
      }),
    ])

    tracker.track(operationEvent('running', { sequence: 2 }))
    tracker.track(operationEvent('queued'))
    tracker.track(
      operationEvent('running', {
        payload: {
          cancelRequested: true,
          state: 'running',
          step: 'Route',
          workspaceRevision: 7,
        },
        sequence: 3,
      }),
    )
    expect(tracker.activeOperations()).toEqual([
      expect.objectContaining({
        cancelRequested: true,
        state: 'running',
        workspaceRevision: 7,
      }),
    ])

    tracker.track(operationEvent('succeeded', { sequence: 4 }))
    tracker.track(operationEvent('succeeded', { sequence: 4 }))
    expect(tracker.activeOperations()).toEqual([])
  })

  it('advances an active rerun to its committed preparation revision', () => {
    const tracker = new RuntimeOperationTracker()
    tracker.track(operationEvent('running', { sequence: 2 }))

    tracker.track({
      ...operationEvent('running'),
      payload: {
        sourceType: 'operation.rerun_prepared',
        workspaceRevision: 8,
      },
      sequence: 3,
      type: 'execution.progress',
      workspaceRevision: 8,
    })

    expect(tracker.activeOperations()).toEqual([
      expect.objectContaining({
        operationId: 'operation-1',
        state: 'running',
        workspaceRevision: 8,
      }),
    ])

    const reordered = new RuntimeOperationTracker()
    reordered.track({
      ...operationEvent('running'),
      payload: {
        sourceType: 'operation.rerun_prepared',
        workspaceRevision: 8,
      },
      sequence: 3,
      type: 'execution.progress',
    })
    reordered.track(operationEvent('queued'))
    expect(reordered.activeOperations()).toHaveLength(1)
  })

  it('keeps an active flow revision-matched as steps commit', () => {
    const tracker = new RuntimeOperationTracker()
    tracker.track(operationEvent('running', { sequence: 2 }))

    tracker.track({
      ...operationEvent('running'),
      payload: {
        sourceType: 'step.completed',
        step: 'Route',
        tool: 'openroad',
        workspaceRevision: 8,
      },
      sequence: 3,
      type: 'workspace.committed',
      workspaceRevision: 8,
    })
    tracker.track({
      ...operationEvent('running'),
      payload: {
        sourceType: 'step.started',
        step: 'STA',
        tool: 'opensta',
      },
      sequence: 4,
      type: 'execution.progress',
    })

    expect(tracker.activeOperations()).toEqual([
      expect.objectContaining({
        currentStep: 'STA',
        currentTool: 'opensta',
        operationId: 'operation-1',
        state: 'running',
        workspaceRevision: 8,
      }),
    ])
  })
})
