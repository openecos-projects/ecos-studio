import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EccRuntimeProtocolPayload } from '@ecos-studio/shared'

import { StepLogEventBridge } from './stepLogEventBridge'

export function v1Marker(event: string, step: string, tool: string): Buffer {
  return Buffer.from(
    `\x1eECC-STEP {"v":1,"event":"${event}","step":"${step}","tool":"${tool}"}\n`,
    'utf8',
  )
}

export function protocolEvent(
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

export interface Harness {
  bridge: StepLogEventBridge
  workspace: string
  emitted: EccRuntimeProtocolPayload[]
  forwarded: EccRuntimeProtocolPayload[]
  unscoped: string[]
  forward: (event: EccRuntimeProtocolPayload) => void
  feed: (...chunks: Buffer[]) => void
  archiveText: (step: string, tool: string) => string
}

export function makeHarness(
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

export function writeFlowJson(
  workspace: string,
  steps: { name: string; tool: string }[],
): void {
  mkdirSync(join(workspace, 'home'), { recursive: true })
  writeFileSync(
    join(workspace, 'home', 'flow.json'),
    JSON.stringify({ steps: steps.map((s) => ({ ...s, state: 'Unstart' })) }),
  )
}
