import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = {
  readError: null as Error | null,
  flow: '',
  listeners: [] as Array<() => void>,
  unwatch: vi.fn(),
}

vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => ({
    workspace: {
      listProjectDirectory: vi.fn(async () => [
        {
          name: 'gcd_place.def.gz',
          path: '/runs/gcd/place_dreamplace/output/gcd_place.def.gz',
          type: 'file',
        },
        {
          name: 'gcd_place.gds',
          path: '/runs/gcd/place_dreamplace/output/gcd_place.gds',
          type: 'file',
        },
      ]),
      readOptionalProjectTextFile: vi.fn(async () => {
        if (testState.readError) throw testState.readError
        return testState.flow
      }),
      watchProjectFile: vi.fn(async (_path: string, listener: () => void) => {
        testState.listeners.push(listener)
        return testState.unwatch
      }),
    },
  }),
}))

import { useAgentFlowProgress } from './useAgentFlowProgress'

function flow(state: string): string {
  return JSON.stringify({
    steps: [
      { name: 'fixFanout', state: 'Success', tool: 'ecc' },
      { name: 'place', state, tool: 'dreamplace' },
    ],
  })
}

describe('useAgentFlowProgress', () => {
  beforeEach(() => {
    testState.readError = null
    testState.flow = flow('Unstart')
    testState.listeners.length = 0
    testState.unwatch.mockReset()
  })

  it('reports step execution and persisted primary artifacts', async () => {
    const messages: string[] = []
    const flowChanges: number[] = []
    const progress = useAgentFlowProgress(
      (message) => messages.push(message),
      () => flowChanges.push(flowChanges.length + 1),
    )

    await progress.start('/runs/gcd')
    expect(flowChanges).toEqual([])
    testState.flow = flow('Ongoing')
    testState.listeners[0]!()
    await vi.waitFor(() => expect(messages).toEqual(['Running place.']))
    await vi.waitFor(() => expect(flowChanges).toEqual([1]))

    testState.flow = flow('Success')
    testState.listeners[0]!()
    await vi.waitFor(() =>
      expect(messages).toEqual([
        'Running place.',
        'Completed place. Saved: /runs/gcd/place_dreamplace/output/gcd_place.def.gz; /runs/gcd/place_dreamplace/output/gcd_place.gds',
      ]),
    )
    await vi.waitFor(() => expect(flowChanges).toEqual([1, 2]))

    progress.stop()
    expect(testState.unwatch).toHaveBeenCalledOnce()
  })

  it('does not block execution when progress tracking is unavailable', async () => {
    const messages: string[] = []
    const progress = useAgentFlowProgress((message) => messages.push(message))
    testState.readError = new Error('unavailable')

    await expect(progress.start('/runs/gcd')).resolves.toBeUndefined()
    expect(messages).toEqual([
      'Live flow progress is unavailable. Execution will continue.',
    ])
  })
})
