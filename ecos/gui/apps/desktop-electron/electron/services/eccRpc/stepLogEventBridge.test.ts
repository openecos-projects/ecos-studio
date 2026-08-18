import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EccRuntimeProtocolPayload } from '@ecos-studio/shared'

import { StepLogEventBridge } from './stepLogEventBridge'

function v1Marker(event: string, step: string, tool: string): Buffer {
  return Buffer.from(
    `\x1eECC-STEP {"v":1,"event":"${event}","step":"${step}","tool":"${tool}"}\n`,
    'utf8',
  )
}

function protocolEvent(
  type: EccRuntimeProtocolPayload['type'],
  payload: Record<string, unknown>,
  overrides: Partial<EccRuntimeProtocolPayload> = {},
): EccRuntimeProtocolPayload {
  return {
    eventId: `ecc-${type}-1`,
    kind: 'flow',
    operationId: 'operation-1',
    origin: 'gui',
    payload,
    rerun: false,
    runSessionId: 'run-session-1',
    runtimeInstanceId: 'runtime-1',
    sequence: 1,
    timestamp: 1000,
    type,
    workspaceId: 'ecc-workspace-1',
    ...overrides,
  }
}

interface Harness {
  bridge: StepLogEventBridge
  workspace: string
  emitted: EccRuntimeProtocolPayload[]
  forwarded: EccRuntimeProtocolPayload[]
  unscoped: string[]
  forward: (event: EccRuntimeProtocolPayload) => void
  feed: (...chunks: Buffer[]) => void
  archiveText: (step: string, tool: string) => string
}

function makeHarness(
  options: { holdTimeoutMs?: number; maxBufferedSegments?: number } = {},
): Harness {
  const workspace = mkdtempSync(join(tmpdir(), 'step-log-bridge-'))
  const emitted: EccRuntimeProtocolPayload[] = []
  const forwarded: EccRuntimeProtocolPayload[] = []
  const unscoped: string[] = []
  const bridge = new StepLogEventBridge({
    workspaceDirectory: workspace,
    emitProtocolEvent: (event) => emitted.push(event),
    emitUnscoped: (text) => unscoped.push(text),
    ...(options.holdTimeoutMs !== undefined
      ? { holdTimeoutMs: options.holdTimeoutMs }
      : {}),
    ...(options.maxBufferedSegments !== undefined
      ? { maxBufferedSegments: options.maxBufferedSegments }
      : {}),
  })
  const forward = (event: EccRuntimeProtocolPayload) => forwarded.push(event)
  return {
    bridge,
    workspace,
    emitted,
    forwarded,
    unscoped,
    forward,
    feed: (...chunks: Buffer[]) => {
      for (const chunk of chunks) {
        bridge.archiver.feed(chunk)
      }
    },
    archiveText: (step, tool) =>
      readFileSync(join(workspace, `${step}_${tool}`, 'log', `${step}.log`), 'utf8'),
  }
}

function writeFlowJson(workspace: string, steps: { name: string; tool: string }[]): void {
  mkdirSync(join(workspace, 'home'), { recursive: true })
  writeFileSync(
    join(workspace, 'home', 'flow.json'),
    JSON.stringify({ steps: steps.map((s) => ({ ...s, state: 'Unstart' })) }),
  )
}

describe('StepLogEventBridge', () => {
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

  it('synthesizes step.log events with the operation identity and chunk payload', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('tool output\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

    expect(h.emitted).toHaveLength(1)
    const event = h.emitted[0]!
    expect(event).toMatchObject({
      kind: 'flow',
      operationId: 'operation-1',
      origin: 'gui',
      rerun: false,
      runSessionId: 'run-session-1',
      runtimeInstanceId: 'runtime-1',
      type: 'step.log',
      workspaceId: 'ecc-workspace-1',
    })
    expect(event.payload).toEqual({
      chunk: 'tool output\n',
      cursor: 'tool output\n'.length,
      step: 'Synthesis',
      tool: 'yosys',
    })
    expect(typeof event.eventId).toBe('string')
    expect(event.eventId).not.toBe('ecc-step.log-1')
  })

  it('mints a unique eventId per synthesized event', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('one\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('two\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

    const ids = h.emitted.map((event) => event.eventId)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sets sequence to the most recently observed ecc sequence', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h, 7)
    startStep(h, 'Synthesis', 'yosys', 8)
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('chunk one\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.emitted[0]!.sequence).toBe(8)

    h.bridge.handleProtocolEvent(
      protocolEvent('subflow.stage', { step: 'Synthesis' }, { sequence: 12 }),
      h.forward,
    )
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('chunk two\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.emitted[1]!.sequence).toBe(12)
  })

  it('buffers segments until step.started has been forwarded', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    // The step's whole byte stream arrives before step.started (pipe race).
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('early output\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.emitted).toEqual([])

    startStep(h, 'Synthesis', 'yosys')
    const forwardedTypes = h.forwarded.map((event) => event.type)
    expect(forwardedTypes).toContain('step.started')
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0]!.payload).toMatchObject({ chunk: 'early output\n' })
  })

  it('drops only synthesis on buffer overflow; the archive stays complete', () => {
    const h = harness({ maxBufferedSegments: 2 })
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    const big1 = Buffer.alloc(20 * 1024, 0x61)
    const big2 = Buffer.alloc(20 * 1024, 0x62)
    const big3 = Buffer.alloc(20 * 1024, 0x63)
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'))
    h.feed(big1, big2, big3)

    startStep(h, 'Synthesis', 'yosys')
    expect(h.emitted).toHaveLength(2)
    expect(h.emitted.map((event) => event.payload.cursor)).toEqual([40 * 1024, 60 * 1024])
    expect(h.archiveText('Synthesis', 'yosys')).toBe(
      Buffer.concat([big1, big2, big3]).toString('utf8'),
    )
  })

  it('forwards step.completed immediately with finalLog when the end marker already arrived', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('full output\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

    const completed = protocolEvent(
      'step.completed',
      { step: 'Synthesis', tool: 'yosys', state: 'Success' },
      { sequence: 3 },
    )
    h.bridge.handleProtocolEvent(completed, h.forward)

    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
      'step.completed',
    ])
    const forwardedCompleted = h.forwarded[2]!
    expect(forwardedCompleted.payload.finalLog).toBe('full output\n')
  })

  it('holds step.completed until the matching StepEnded, then attaches finalLog', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('late output\n'))

    const completed = protocolEvent(
      'step.completed',
      { step: 'Synthesis', tool: 'yosys', state: 'Success' },
      { sequence: 3 },
    )
    h.bridge.handleProtocolEvent(completed, h.forward)
    // step.completed arrived before the end marker: it must be held.
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
    ])

    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.started',
      'step.completed',
    ])
    expect(h.forwarded[2]!.payload.finalLog).toBe('late output\n')
  })

  it('releases a held step.completed on timeout and still forwards', () => {
    vi.useFakeTimers()
    const h = harness({ holdTimeoutMs: 2000 })
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('partial output\n'))

    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Imcomplete' },
        { sequence: 3 },
      ),
      h.forward,
    )
    expect(h.forwarded).toHaveLength(2)

    vi.advanceTimersByTime(2000)
    expect(h.forwarded).toHaveLength(3)
    expect(h.forwarded[2]!.type).toBe('step.completed')
    expect(h.forwarded[2]!.payload.finalLog).toBe('partial output\n')
    expect(h.unscoped.join('')).toContain('did not arrive')
  })

  it('releases a held step.completed on sidecar close', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('at close\n'))

    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { sequence: 3 },
      ),
      h.forward,
    )
    expect(h.forwarded).toHaveLength(2)

    h.bridge.handleSidecarClose()
    expect(h.forwarded).toHaveLength(3)
    expect(h.forwarded[2]!.payload.finalLog).toBe('at close\n')
    expect(h.archiveText('Synthesis', 'yosys')).toBe('at close\n')
  })

  it('refreshes the allowlist on operation.started and rerun_prepared', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')

    // floorplan is not in the allowlist yet: its begin degrades to unscoped.
    h.feed(v1Marker('begin', 'Floorplan', 'ecc'))
    expect(h.unscoped.join('')).toContain('Floorplan')

    // The flow gains the step; rerun_prepared reloads the allowlist.
    writeFlowJson(h.workspace, [
      { name: 'Synthesis', tool: 'yosys' },
      { name: 'Floorplan', tool: 'ecc' },
    ])
    h.bridge.handleProtocolEvent(
      protocolEvent('operation.rerun_prepared', { affectedSteps: ['Floorplan'] }),
      h.forward,
    )
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    startStep(h, 'Floorplan', 'ecc')
    h.feed(v1Marker('begin', 'Floorplan', 'ecc'), Buffer.from('floorplan output\n'))
    h.feed(v1Marker('end', 'Floorplan', 'ecc'))
    expect(h.archiveText('Floorplan', 'ecc')).toBe('floorplan output\n')
  })

  it('keeps archiving but never synthesizes without an operation context', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    h.bridge.refreshAllowlist()
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('orphan output\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

    expect(h.archiveText('Synthesis', 'yosys')).toBe('orphan output\n')
    expect(h.emitted).toEqual([])
  })

  it('bounds the finalLog tail', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    const big = Buffer.alloc(80 * 1024, 0x61)
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), big)
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Success' },
        { sequence: 3 },
      ),
      h.forward,
    )
    const finalLog = h.forwarded[2]!.payload.finalLog
    expect(typeof finalLog).toBe('string')
    expect(Buffer.byteLength(finalLog as string, 'utf8')).toBeLessThanOrEqual(64 * 1024)
  })

  it('releases pre-operation.started segments with the current operation identity', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    // The workspace-open path loads the allowlist before any operation.
    h.bridge.refreshAllowlist()
    // The stderr stream races the RPC channel: begin + bytes + end all
    // arrive before operation.started is observed.
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('raced output\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.emitted).toEqual([])

    startOperation(h)
    expect(h.emitted).toEqual([])
    startStep(h, 'Synthesis', 'yosys')
    expect(h.emitted).toHaveLength(1)
    expect(h.emitted[0]).toMatchObject({
      operationId: 'operation-1',
      runSessionId: 'run-session-1',
      type: 'step.log',
    })
    expect(h.emitted[0]!.payload.chunk).toBe('raced output\n')
  })

  it('attributes segments to the operation that produced them across operations', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)
    startStep(h, 'Synthesis', 'yosys')
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('first run\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    h.bridge.handleProtocolEvent(
      protocolEvent('operation.completed', {}, { sequence: 9 }),
      h.forward,
    )

    // The next operation's bytes arrive before its operation.started.
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('second run\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))

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

    const chunks = h.emitted.map((event) => [
      event.operationId,
      event.runSessionId,
      event.payload.chunk,
    ])
    expect(chunks).toEqual([
      ['operation-1', 'run-session-1', 'first run\n'],
      ['operation-2', 'run-session-2', 'second run\n'],
    ])
  })

  it('forwards skipped step completions immediately without a hold', () => {
    vi.useFakeTimers()
    const h = harness({ holdTimeoutMs: 2000 })
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h)

    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Skipped' },
        { sequence: 2 },
      ),
      h.forward,
    )
    h.bridge.handleProtocolEvent(
      protocolEvent('operation.completed', {}, { sequence: 3 }),
      h.forward,
    )

    // No hold, no timer wait: lifecycle order is preserved.
    expect(h.forwarded.map((event) => event.type)).toEqual([
      'operation.started',
      'step.completed',
      'operation.completed',
    ])
    expect(h.forwarded[1]!.payload.finalLog).toBe('')
    expect(h.unscoped.join('')).not.toContain('did not arrive')
  })

  it('uses the latest observed sequence, not the maximum', () => {
    const h = harness()
    writeFlowJson(h.workspace, [{ name: 'Synthesis', tool: 'yosys' }])
    startOperation(h, 10)
    startStep(h, 'Synthesis', 'yosys', 11)
    // A replay carries an older sequence; synthesized events follow it.
    h.bridge.handleProtocolEvent(
      protocolEvent(
        'step.started',
        { step: 'Synthesis', tool: 'yosys' },
        { sequence: 4 },
      ),
      h.forward,
    )
    h.feed(v1Marker('begin', 'Synthesis', 'yosys'), Buffer.from('after replay\n'))
    h.feed(v1Marker('end', 'Synthesis', 'yosys'))
    expect(h.emitted[0]!.sequence).toBe(4)
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
})
