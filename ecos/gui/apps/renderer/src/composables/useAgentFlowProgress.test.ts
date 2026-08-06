import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = {
  readError: null as Error | null,
  files: new Map<string, string>(),
  listeners: new Map<string, Array<() => void>>(),
  unwatch: vi.fn(),
}

vi.mock('@/platform/desktop', () => ({
  getOptionalDesktopApi: () => ({
    workspace: {
      readOptionalProjectTextFile: vi.fn(async (path: string) => {
        if (testState.readError) throw testState.readError
        return testState.files.get(path) ?? null
      }),
      watchProjectFile: vi.fn(async (path: string, listener: () => void) => {
        const bucket = testState.listeners.get(path) ?? []
        bucket.push(listener)
        testState.listeners.set(path, bucket)
        return testState.unwatch
      }),
    },
  }),
}))

import { useAgentFlowProgress } from './useAgentFlowProgress'

const FLOW_PATH = '/runs/gcd/home/flow.json'
const SUBFLOW_PATH = '/runs/gcd/place_dreamplace/subflow.json'

function flow(state: string): string {
  return JSON.stringify({
    steps: [
      { name: 'FixFanout', state: 'Success', tool: 'ecc' },
      { name: 'place', state, tool: 'dreamplace' },
    ],
  })
}

function subflow(
  steps: Array<{ name: string; state: string; runtime?: string; memory?: number }>,
): string {
  return JSON.stringify({
    steps: steps.map((step) => ({
      name: step.name,
      state: step.state,
      runtime: step.runtime ?? '0:0:0',
      'peak memory (mb)': step.memory ?? 0,
    })),
  })
}

function emit(path: string): void {
  for (const listener of testState.listeners.get(path) ?? []) listener()
}

describe('useAgentFlowProgress', () => {
  beforeEach(() => {
    testState.readError = null
    testState.files = new Map([[FLOW_PATH, flow('Unstart')]])
    testState.listeners = new Map()
    testState.unwatch.mockReset()
  })

  it('reports stage progress with live subflow steps instead of artifact paths', async () => {
    const messages: string[] = []
    const flowChanges: number[] = []
    const progress = useAgentFlowProgress(
      (message) => messages.push(message),
      () => flowChanges.push(flowChanges.length + 1),
    )

    await progress.start('/runs/gcd')
    expect(flowChanges).toEqual([])

    testState.files.set(FLOW_PATH, flow('Ongoing'))
    testState.files.set(
      SUBFLOW_PATH,
      subflow([{ name: 'load data', state: 'Ongoing' }]),
    )
    emit(FLOW_PATH)
    await vi.waitFor(() =>
      expect(messages).toEqual(['Running place.', 'place › load data']),
    )
    await vi.waitFor(() => expect(flowChanges).toEqual([1]))

    testState.files.set(
      SUBFLOW_PATH,
      subflow([
        { name: 'load data', state: 'Success' },
        { name: 'run placement', state: 'Ongoing', memory: 29.883, runtime: '0:1:10' },
      ]),
    )
    emit(SUBFLOW_PATH)
    await vi.waitFor(() =>
      expect(messages).toEqual([
        'Running place.',
        'place › load data',
        'place › run placement',
      ]),
    )

    testState.files.set(
      SUBFLOW_PATH,
      subflow([
        { name: 'load data', state: 'Success' },
        { name: 'run placement', state: 'Success', memory: 29.883, runtime: '0:1:10' },
        { name: 'save data', state: 'Success', memory: 29.887 },
        { name: 'analysis', state: 'Success', memory: 0.004 },
      ]),
    )
    testState.files.set(FLOW_PATH, flow('Success'))
    emit(FLOW_PATH)
    await vi.waitFor(() =>
      expect(messages).toEqual([
        'Running place.',
        'place › load data',
        'place › run placement',
        'place › save data',
        'place › analysis',
        'Completed place.',
      ]),
    )
    await vi.waitFor(() => expect(flowChanges).toEqual([1, 2]))
    expect(messages.some((message) => message.includes('Saved:'))).toBe(false)

    progress.stop()
    expect(testState.unwatch).toHaveBeenCalled()
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
