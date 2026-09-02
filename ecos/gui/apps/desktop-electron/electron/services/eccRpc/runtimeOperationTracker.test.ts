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
      cancelRequested: state === 'running',
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
    expect(tracker.activeOperations()).toEqual([
      expect.objectContaining({
        cancelRequested: true,
        state: 'running',
        workspaceRevision: 7,
      }),
    ])

    tracker.track(operationEvent('succeeded', { sequence: 3 }))
    tracker.track(operationEvent('succeeded', { sequence: 3 }))
    expect(tracker.activeOperations()).toEqual([])
  })
})
