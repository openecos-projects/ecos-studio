import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { RuntimeEventResponse } from '@/api/runtimeEvents'
import { useAgentFlowProgress } from './useAgentFlowProgress'

function runtimeEvent(
  type: string,
  options: { eventId: string; state?: string; step?: string } = {
    eventId: 'event-1',
  },
): RuntimeEventResponse {
  return {
    cmd: 'notify',
    data: {
      directory: '/runs/gcd',
      runtimeEventId: options.eventId,
      runtimeProtocolType: type,
      state: options.state,
      step: options.step,
      type: type === 'step.started' ? 'step_start' : 'step_complete',
    },
    message: [],
    response: 'success',
  }
}

describe('useAgentFlowProgress', () => {
  it('reports ordered ECC step events without reading or watching NFS files', async () => {
    const messages: string[] = []
    const changes: number[] = []
    const events = ref<RuntimeEventResponse[]>([])
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
    const events = ref<RuntimeEventResponse[]>([])
    const progress = useAgentFlowProgress((message) => messages.push(message), undefined, events)
    progress.start('/runs/gcd')

    events.value.push(runtimeEvent('step.started', { eventId: 'event-1', step: 'place' }))
    await nextTick()
    events.value.push(runtimeEvent('step.started', { eventId: 'event-1', step: 'place' }))
    await nextTick()
    events.value.push({
      ...runtimeEvent('step.started', { eventId: 'event-2', step: 'route' }),
      data: {
        ...runtimeEvent('step.started', { eventId: 'event-2', step: 'route' }).data,
        directory: '/runs/other',
      },
    })
    await nextTick()

    expect(messages).toEqual(['Running place.'])
  })
})
