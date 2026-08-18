import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EccRuntimeEvent, EccRuntimeProtocolPayload } from '@ecos-studio/shared'

import type { JsonRpcNotificationPayload } from './jsonRpcClient'
import { RuntimeOperationTracker } from './runtimeOperationTracker'
import type { EccRpcRuntimeClient, EccRpcRuntimeSidecar } from './runtimeClient'
import type { StepLogArchiver } from './stepLogArchiver'
import { EccWorkspaceRuntime } from './workspaceRuntime'

function v1Marker(event: string, step: string, tool: string): Buffer {
  return Buffer.from(
    `\x1eECC-STEP {"v":1,"event":"${event}","step":"${step}","tool":"${tool}"}\n`,
    'utf8',
  )
}

function runtimeNotification(
  type: EccRuntimeProtocolPayload['type'],
  payload: Record<string, unknown>,
  overrides: Partial<EccRuntimeProtocolPayload> = {},
): JsonRpcNotificationPayload {
  return {
    method: 'runtime.event',
    params: {
      eventId: `runtime-1:operation-1:${type}`,
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
    } satisfies EccRuntimeProtocolPayload,
  } as JsonRpcNotificationPayload
}

class FakeRpcClient implements EccRpcRuntimeClient {
  async call<T>(): Promise<T> {
    throw new Error('not implemented')
  }
}

class FakeSidecar implements EccRpcRuntimeSidecar {
  logFile: string | null = '/tmp/ecc-rpc-runtime.log'
  archiver: StepLogArchiver | null = null
  stderrTexts: string[] = []
  onUnscopedEvent: ((text: string) => void) | null = null

  attachStepLogArchiver(archiver: StepLogArchiver): void {
    this.archiver = archiver
  }

  appendStderrText(text: string): void {
    this.stderrTexts.push(text)
    this.onUnscopedEvent?.(text)
  }

  async shutdown(): Promise<void> {}
  async start(): Promise<EccRpcRuntimeClient> {
    return new FakeRpcClient()
  }
}

describe('step log runtime integration', () => {
  let workspace = ''
  let events: EccRuntimeEvent[] = []
  let sidecar: FakeSidecar
  let notify: (notification: JsonRpcNotificationPayload) => void = () => undefined
  let emitSidecarEvent: (event: EccRuntimeEvent) => void = () => undefined

  function setup(): EccWorkspaceRuntime {
    workspace = mkdtempSync(join(tmpdir(), 'step-log-runtime-'))
    mkdirSync(join(workspace, 'home'), { recursive: true })
    writeFileSync(
      join(workspace, 'home', 'flow.json'),
      JSON.stringify({
        steps: [{ name: 'Synthesis', tool: 'yosys', state: 'Unstart' }],
      }),
    )
    events = []
    sidecar = new FakeSidecar()
    const service = new EccWorkspaceRuntime({
      createSidecar: (onEvent, onNotification) => {
        sidecar.onUnscopedEvent = (text) =>
          onEvent({ logFile: sidecar.logFile ?? undefined, text, type: 'runtime.stderr' })
        emitSidecarEvent = onEvent
        notify = onNotification
        return sidecar
      },
      directory: workspace,
      onEvent: (event) => events.push(event),
    })
    return service
  }

  afterEach(() => {
    if (workspace) {
      rmSync(workspace, { force: true, recursive: true })
      workspace = ''
    }
  })

  function protocolEvents(): EccRuntimeProtocolPayload[] {
    return events
      .filter(
        (event): event is Extract<EccRuntimeEvent, { type: 'runtime.protocol' }> =>
          event.type === 'runtime.protocol',
      )
      .map((event) => event.event)
  }

  it('fans out synthesized step.log events with workspace context, tracker untouched', () => {
    const trackSpy = vi.spyOn(RuntimeOperationTracker.prototype, 'track')
    setup()
    expect(sidecar.archiver).not.toBeNull()

    notify(runtimeNotification('operation.started', {}, { sequence: 3 }))
    notify(
      runtimeNotification(
        'step.started',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { sequence: 4 },
      ),
    )
    sidecar.archiver!.feed(v1Marker('begin', 'Synthesis', 'yosys'))
    sidecar.archiver!.feed(Buffer.from('live synthesis output\n'))
    sidecar.archiver!.feed(v1Marker('end', 'Synthesis', 'yosys'))

    const synthesized = protocolEvents().filter((event) => event.type === 'step.log')
    expect(synthesized).toHaveLength(1)
    expect(synthesized[0]).toMatchObject({
      kind: 'flow',
      operationId: 'operation-1',
      origin: 'gui',
      sequence: 4,
      workspaceId: 'ecc-workspace-1',
    })
    expect(synthesized[0]!.payload).toEqual({
      chunk: 'live synthesis output\n',
      cursor: 'live synthesis output\n'.length,
      step: 'Synthesis',
      tool: 'yosys',
    })

    const wrapped = events.find(
      (event) => event.type === 'runtime.protocol' && event.event.type === 'step.log',
    )
    expect(wrapped).toMatchObject({
      type: 'runtime.protocol',
      workspaceDirectory: workspace,
    })

    // Synthesized events never pass through the operation tracker.
    expect(trackSpy.mock.calls.every(([event]) => event.type !== 'step.log')).toBe(true)
    trackSpy.mockRestore()

    // No marker text reaches the sidecar log or runtime.stderr events.
    expect(sidecar.stderrTexts.join('')).not.toContain('ECC-STEP')
    const stderrEvents = events.filter((event) => event.type === 'runtime.stderr')
    expect(stderrEvents.join('')).not.toContain('ECC-STEP')

    // The archive holds the step bytes.
    const archived = readFileSync(
      join(workspace, 'Synthesis_yosys', 'log', 'Synthesis.log'),
      'utf8',
    )
    expect(archived).toBe('live synthesis output\n')
  })

  it('routes unscoped bytes to the sidecar log and runtime.stderr', () => {
    setup()
    notify(runtimeNotification('operation.started', {}, { sequence: 1 }))
    sidecar.archiver!.feed(Buffer.from('executor warning outside any step\n'))

    expect(sidecar.stderrTexts).toEqual(['executor warning outside any step\n'])
    const stderrEvents = events.filter((event) => event.type === 'runtime.stderr')
    expect(stderrEvents).toHaveLength(1)
    expect(stderrEvents[0]).toMatchObject({
      text: 'executor warning outside any step\n',
      type: 'runtime.stderr',
    })
  })

  it('releases a held step.completed with finalLog before runtime.exited on close', () => {
    setup()
    notify(runtimeNotification('operation.started', {}, { sequence: 3 }))
    notify(
      runtimeNotification(
        'step.started',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { sequence: 4 },
      ),
    )
    sidecar.archiver!.feed(v1Marker('begin', 'Synthesis', 'yosys'))
    sidecar.archiver!.feed(Buffer.from('output before crash\n'))

    // step.completed arrives before the end marker (executor crash race).
    notify(
      runtimeNotification(
        'step.completed',
        { step: 'Synthesis', tool: 'yosys', state: 'Ongoing' },
        { sequence: 5 },
      ),
    )
    expect(protocolEvents().some((event) => event.type === 'step.completed')).toBe(false)

    emitSidecarEvent({
      code: 1,
      reason: 'unexpected',
      signal: null,
      type: 'runtime.exited',
    })

    const types = events.map((event) =>
      event.type === 'runtime.protocol' ? event.event.type : event.type,
    )
    const completedIndex = types.indexOf('step.completed')
    const exitedIndex = types.indexOf('runtime.exited')
    expect(completedIndex).toBeGreaterThanOrEqual(0)
    expect(exitedIndex).toBeGreaterThan(completedIndex)
    const completed = protocolEvents().find((event) => event.type === 'step.completed')
    expect(completed?.payload.finalLog).toBe('output before crash\n')
  })
})
