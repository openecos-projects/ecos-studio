import { rmSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  makeHarness,
  protocolEvent,
  v1Marker,
  writeFlowJson,
  type Harness,
} from './stepLogEventBridge.testSupport'

describe('StepLogEventBridge lifecycle', () => {
  let workspaceDirs: string[] = []

  function harness(options: Parameters<typeof makeHarness>[0] = {}): Harness {
    const h = makeHarness(options)
    workspaceDirs.push(h.workspace)
    return h
  }

  function startOperation(h: Harness, sequence = 1): void {
    h.bridge.handleProtocolEvent(
      protocolEvent('operation.started', {}, { sequence }),
      h.forward,
    )
  }

  function startStep(h: Harness, step: string, tool: string, sequence = 2): void {
    h.bridge.handleProtocolEvent(
      protocolEvent('step.started', { step, tool, state: 'Ongoing' }, { sequence }),
      h.forward,
    )
  }

  beforeEach(() => {
    workspaceDirs = []
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const dir of workspaceDirs) {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  it('resets lifecycle state on sidecar close', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h, 42)
    startStep(h, 'Synthesis', 'yosys', 43)
    h.bridge.handleSidecarClose()

    h.bridge.handleProtocolEvent(
      protocolEvent(
        'operation.started',
        {},
        {
          operationId: 'operation-2',
          runSessionId: 'run-session-2',
          sequence: 1,
        },
      ),
      h.forward,
    )
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.started',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { operationId: 'operation-2', runSessionId: 'run-session-2', sequence: 2 },
      ),
      h.forward,
    )
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('after restart\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.emitted[0]!.sequence).toBe(2)
    expect(h.emitted[0]!.operationId).toBe('operation-2')
  })

  it('holds a terminal operation event behind a held step.completed', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('failing output\n'))

    // A failed step does not wait for the render gate: step.completed and
    // operation.failed can both arrive before the stderr end marker.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Imcomplete' },
        { sequence: 3 },
      ),
      h.forward,
    )
    h.bridge.handleProtocolEvent(
      protocolEvent('operation.failed', { error: { message: 'x' } }, { sequence: 4 }),
      h.forward,
    )
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
    ])

    // The end marker finally arrives: completion first, then the terminal.
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
      'step.completed',
      'operation.failed',
    ])
    expect(h.forwarded[2]!.payload.finalLog).toBe('failing output\n')
  })

  it('forwards a queued terminal on hold timeout after the completion', () => {
    vi.useFakeTimers()
    const h = harness({ holdTimeoutMs: 2000 })
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('some output\n'))

    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Imcomplete' },
        { sequence: 3 },
      ),
      h.forward,
    )
    h.bridge.handleProtocolEvent(
      protocolEvent('operation.failed', { error: { message: 'x' } }, { sequence: 4 }),
      h.forward,
    )

    vi.advanceTimersByTime(2000)
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
      'step.completed',
      'operation.failed',
    ])
  })

  it('abandons the stale archive on timeout so the next run starts fresh', () => {
    vi.useFakeTimers()
    const h = harness({ holdTimeoutMs: 2000 })
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('first attempt\n'))

    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Imcomplete' },
        { sequence: 3 },
      ),
      h.forward,
    )
    vi.advanceTimersByTime(2000)
    expect(h.forwarded.map((event) => event.type)).toContain('step.completed')

    // The next attempt's begin must not read as nested inside the stale one.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'operation.started',
        {},
        {
          operationId: 'operation-2',
          runSessionId: 'run-session-2',
          sequence: 4,
        },
      ),
      h.forward,
    )
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.started',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { operationId: 'operation-2', runSessionId: 'run-session-2', sequence: 5 },
      ),
      h.forward,
    )
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('second attempt\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

    expect(h.archiveText('Synthesis', 'yosys')).toBe('second attempt\n')
    const synthesized = h.emitted.filter((event) => event.type === 'step.log')
    expect(synthesized.at(-1)?.operationId).toBe('operation-2')
    expect(synthesized.at(-1)?.payload.chunk).toBe('second attempt\n')
  })

  it('tracks attempts across reruns when completion precedes the end marker', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')

    // First attempt: completion arrives before its end marker.
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('attempt one\n'))
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Success' },
        { sequence: 3 },
      ),
      h.forward,
    )
    expect(h.forwarded.map((event) => event.type)).not.toContain('step.completed')
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.forwarded[2]!.payload.finalLog).toBe('attempt one\n')

    // Rerun the same step: its completion must also wait for its own end.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.started',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { sequence: 4 },
      ),
      h.forward,
    )
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('attempt two\n'))
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Success' },
        { sequence: 5 },
      ),
      h.forward,
    )
    const completedBefore = h.forwarded.filter((event) => event.type === 'step.completed')
    expect(completedBefore).toHaveLength(1)
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    const completedAfter = h.forwarded.filter((event) => event.type === 'step.completed')
    expect(completedAfter).toHaveLength(2)
    expect(completedAfter[1]!.payload.finalLog).toBe('attempt two\n')
  })

  it('resolves a held completion and queued terminal before a new operation starts', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('failed output\n'))

    // The step's completion is held (no end marker yet) and the terminal
    // event queues behind it.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Imcomplete' },
        { sequence: 3 },
      ),
      h.forward,
    )
    h.bridge.handleProtocolEvent(
      protocolEvent('operation.failed', { error: { message: 'x' } }, { sequence: 4 }),
      h.forward,
    )
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
    ])

    // ecc allows a new operation once the previous one is terminal: its
    // start must first resolve the leftover hold and terminal in order.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'operation.started',
        {},
        {
          operationId: 'operation-2',
          runSessionId: 'run-session-2',
          sequence: 5,
        },
      ),
      h.forward,
    )
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
      'step.completed',
      'operation.failed',
      'operation.started',
    ])
    expect(h.forwarded[2]!.payload.finalLog).toBe('failed output\n')
    expect(h.forwarded[4]!.operationId).toBe('operation-2')

    // The new operation's markers start a fresh archive attempt.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.started',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { operationId: 'operation-2', runSessionId: 'run-session-2', sequence: 6 },
      ),
      h.forward,
    )
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('fresh run\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.archiveText('Synthesis', 'yosys')).toBe('fresh run\n')
    expect(h.emitted.at(-1)?.operationId).toBe('operation-2')
  })
  it('forwards render-gate replayed completions without re-holding', () => {
    vi.useFakeTimers()
    const h = harness({ holdTimeoutMs: 2000 })
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('output\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

    // The original completion is accounted: ended > completed releases it.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Success' },
        { sequence: 3 },
      ),
      h.forward,
    )
    // The render gate replays the same completion while it waits for the ack.
    // The replay must forward immediately rather than be re-held.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        {
          step: 'Synthesis',
          tool: 'yosys',
          state: 'Success',
          replayed: true,
          retryCount: 1,
        },
        { sequence: 3 },
      ),
      h.forward,
    )

    const types = h.forwarded.map((event) => event.type)
    expect(types).toEqual([
      'operation.started',
      'step.started',
      'step.completed',
      'step.completed',
    ])
    expect(h.unscoped.join('')).not.toContain('did not arrive')
    vi.advanceTimersByTime(10_000)
    expect(h.forwarded).toHaveLength(4)
  })
})
