import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { DesignRuntimeEvent } from '@ecos-studio/shared'
import { useAgentFlowProgress } from './useAgentFlowProgress'

function runtimeEvent(
  type: string,
  options: {
    eventId: string
    operationId?: string
    runtimeInstanceId?: string
    state?: string
    step?: string
    workspaceId?: string
  } = {
    eventId: 'event-1',
  },
): DesignRuntimeEvent {
  return {
    designTool: 'backend',
    event: {
      eventId: options.eventId,
      kind: 'flow',
      operationId: options.operationId ?? 'operation-1',
      origin: 'gui',
      payload: { sourceType: type, state: options.state, step: options.step },
      runtimeInstanceId: options.runtimeInstanceId,
      sequence: 1,
      timestamp: 1,
      type: 'execution.progress',
      workspaceId: options.workspaceId ?? 'workspace-gcd',
    },
    type: 'runtime.protocol',
    workspaceDirectory: '/runs/gcd',
    workspaceHandle: 'workspace-handle',
  }
}

describe('useAgentFlowProgress', () => {
  it('reports ordered ECC step events without reading or watching NFS files', async () => {
    const messages: string[] = []
    const changes: number[] = []
    const events = ref<DesignRuntimeEvent[]>([])
    const progress = useAgentFlowProgress(
      (message) => messages.push(message),
      () => changes.push(changes.length + 1),
      events,
    )

    progress.start('/runs/gcd')
    events.value.push(runtimeEvent('step.started', { eventId: 'event-1', step: 'place' }))
    await nextTick()
    events.value.push(
      runtimeEvent('step.completed', {
        eventId: 'event-2',
        state: 'Success',
        step: 'place',
      }),
    )
    await nextTick()

    expect(messages).toEqual(['Running place.', 'Completed place.'])
    expect(changes).toEqual([1])
  })

  it('ignores duplicate and unrelated workspace protocol events', async () => {
    const messages: string[] = []
    const events = ref<DesignRuntimeEvent[]>([])
    const progress = useAgentFlowProgress(
      (message) => messages.push(message),
      undefined,
      events,
    )
    progress.start('/runs/gcd')

    events.value.push(runtimeEvent('step.started', { eventId: 'event-1', step: 'place' }))
    await nextTick()
    events.value.push(runtimeEvent('step.started', { eventId: 'event-1', step: 'place' }))
    await nextTick()
    events.value.push({
      ...runtimeEvent('step.started', { eventId: 'event-2', step: 'route' }),
      workspaceDirectory: '/runs/other',
    })
    await nextTick()

    expect(messages).toEqual(['Running place.'])
  })

  it('accepts a reused event id from a new ECC sidecar instance', async () => {
    const messages: string[] = []
    const events = ref<DesignRuntimeEvent[]>([])
    const progress = useAgentFlowProgress(
      (message) => messages.push(message),
      undefined,
      events,
    )
    progress.start('/runs/gcd')

    events.value.push(
      runtimeEvent('step.started', {
        eventId: 'workspace-gcd:1',
        operationId: 'operation-old',
        runtimeInstanceId: 'runtime-old',
        step: 'place',
        workspaceId: 'workspace-gcd',
      }),
    )
    await nextTick()
    events.value.push(
      runtimeEvent('step.started', {
        eventId: 'workspace-gcd:1',
        operationId: 'operation-new',
        runtimeInstanceId: 'runtime-new',
        step: 'place',
        workspaceId: 'workspace-gcd',
      }),
    )
    await nextTick()

    expect(messages).toEqual(['Running place.', 'Running place.'])
  })
})
