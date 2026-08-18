import { randomUUID } from 'node:crypto'

import type {
  EccRuntimeOperationKind,
  EccRuntimeProtocolPayload,
} from '@ecos-studio/shared'

import {
  StepLogArchiver,
  readFlowJsonStepAllowlist,
  stepLogKey,
  type StepLogSegment,
  type StepLogStepRef,
} from './stepLogArchiver'

/**
 * Synthesizes the `step.log` / `finalLog` runtime events from the step log
 * archiver's segments, keeping the renderer's contract identical to the
 * ecc-emitted events it replaces.
 *
 * Ordering rules:
 * - Synthesized events are emitted into the fanout after the operation
 *   tracker, never through it.
 * - Segments for a step are buffered until that step's `step.started` has
 *   been forwarded; on buffer overflow the file still holds every byte and
 *   only synthesis drops segments.
 * - `step.completed` is held until the archiver reports the matching
 *   StepEnded, with a timeout and sidecar close as cancellation sources, so
 *   a missing end marker can never wedge a step in the UI.
 */

const DEFAULT_HOLD_TIMEOUT_MS = 2000
const DEFAULT_FINAL_LOG_BYTES = 64 * 1024
const DEFAULT_MAX_BUFFERED_SEGMENTS = 256

interface OperationContext {
  kind?: EccRuntimeOperationKind
  operationId: string
  origin: 'gui' | 'cli'
  rerun?: boolean
  runSessionId?: string
  runtimeInstanceId?: string
  workspaceId: string
}

interface HeldStepCompleted {
  event: EccRuntimeProtocolPayload
  forward: (event: EccRuntimeProtocolPayload) => void
  timer: NodeJS.Timeout
}

export interface StepLogEventBridgeOptions {
  workspaceDirectory: string
  emitProtocolEvent: (event: EccRuntimeProtocolPayload) => void
  emitUnscoped: (text: string) => void
  holdTimeoutMs?: number
  finalLogBytes?: number
  maxBufferedSegments?: number
}

export class StepLogEventBridge {
  readonly archiver: StepLogArchiver
  private readonly holdTimeoutMs: number
  private readonly finalLogBytes: number
  private readonly maxBufferedSegments: number
  private operationContext: OperationContext | null = null
  private lastSequence = 0
  private readonly startedSteps = new Set<string>()
  private readonly bufferedSegments = new Map<string, StepLogSegment[]>()
  private readonly endedStepCounts = new Map<string, number>()
  private readonly completedStepCounts = new Map<string, number>()
  private heldCompleted: HeldStepCompleted | null = null

  constructor(private readonly options: StepLogEventBridgeOptions) {
    this.holdTimeoutMs = options.holdTimeoutMs ?? DEFAULT_HOLD_TIMEOUT_MS
    this.finalLogBytes = options.finalLogBytes ?? DEFAULT_FINAL_LOG_BYTES
    this.maxBufferedSegments =
      options.maxBufferedSegments ?? DEFAULT_MAX_BUFFERED_SEGMENTS
    this.archiver = new StepLogArchiver({
      workspaceDirectory: options.workspaceDirectory,
      onSegment: (segment) => this.handleSegment(segment),
      onStepEnded: (ref) => this.handleStepEnded(ref),
      onUnscoped: (text) => options.emitUnscoped(text),
      onProtocolViolation: (reason) => options.emitUnscoped(`[step-log] ${reason}\n`),
    })
  }

  /** Reload the flow.json allowlist into the archiver. */
  refreshAllowlist(): void {
    this.archiver.refreshAllowlistKeys(
      readFlowJsonStepAllowlist(this.options.workspaceDirectory),
    )
  }

  /**
   * Observe a protocol event from ecc. `forward` emits the event into the
   * fanout (after the operation tracker); the bridge may delay it for
   * `step.completed` while it waits for the archiver's StepEnded.
   */
  handleProtocolEvent(
    event: EccRuntimeProtocolPayload,
    forward: (event: EccRuntimeProtocolPayload) => void,
  ): void {
    if (typeof event.sequence === 'number') {
      this.lastSequence = Math.max(this.lastSequence, event.sequence)
    }
    if (event.type === 'operation.started') {
      this.operationContext = {
        kind: event.kind,
        operationId: event.operationId,
        origin: event.origin,
        rerun: event.rerun,
        runSessionId: event.runSessionId,
        runtimeInstanceId: event.runtimeInstanceId,
        workspaceId: event.workspaceId,
      }
      this.startedSteps.clear()
      this.bufferedSegments.clear()
      this.endedStepCounts.clear()
      this.completedStepCounts.clear()
      this.refreshAllowlist()
      forward(event)
      return
    }
    if (event.type === 'operation.rerun_prepared') {
      this.refreshAllowlist()
      forward(event)
      return
    }
    if (event.type === 'step.started') {
      forward(event)
      const key = stepLogKey(
        typeof event.payload.step === 'string' ? event.payload.step : '',
        typeof event.payload.tool === 'string' ? event.payload.tool : '',
      )
      this.startedSteps.add(key)
      this.releaseBufferedSegments(key)
      return
    }
    if (event.type === 'step.completed') {
      this.holdOrForwardStepCompleted(event, forward)
      return
    }
    forward(event)
  }

  handleSidecarClose(): void {
    this.archiver.close()
    this.bufferedSegments.clear()
    const held = this.heldCompleted
    if (held) {
      this.heldCompleted = null
      clearTimeout(held.timer)
      this.releaseStepCompleted(held)
    }
  }

  private handleSegment(segment: StepLogSegment): void {
    const key = stepLogKey(segment.step, segment.tool)
    if (!this.startedSteps.has(key)) {
      const queue = this.bufferedSegments.get(key) ?? []
      queue.push(segment)
      // Overflow drops only synthesis; the archive file stays complete.
      while (queue.length > this.maxBufferedSegments) {
        queue.shift()
      }
      this.bufferedSegments.set(key, queue)
      return
    }
    this.emitSegment(segment)
  }

  private handleStepEnded(ref: StepLogStepRef): void {
    const key = stepLogKey(ref.step, ref.tool)
    this.endedStepCounts.set(key, (this.endedStepCounts.get(key) ?? 0) + 1)
    const held = this.heldCompleted
    if (
      held &&
      stepLogKey(
        typeof held.event.payload.step === 'string' ? held.event.payload.step : '',
        typeof held.event.payload.tool === 'string' ? held.event.payload.tool : '',
      ) === key
    ) {
      this.heldCompleted = null
      clearTimeout(held.timer)
      this.releaseStepCompleted(held)
    }
  }

  private holdOrForwardStepCompleted(
    event: EccRuntimeProtocolPayload,
    forward: (event: EccRuntimeProtocolPayload) => void,
  ): void {
    const step = typeof event.payload.step === 'string' ? event.payload.step : ''
    const tool = typeof event.payload.tool === 'string' ? event.payload.tool : ''
    const key = stepLogKey(step, tool)
    const ended = this.endedStepCounts.get(key) ?? 0
    const completed = this.completedStepCounts.get(key) ?? 0
    if (ended > completed) {
      // Common case: the end marker arrived before step.completed, so the
      // archive already holds every byte of this attempt.
      this.completedStepCounts.set(key, completed + 1)
      this.forwardWithFinalLog(event, forward)
      return
    }
    const held: HeldStepCompleted = {
      event,
      forward,
      timer: setTimeout(() => {
        if (this.heldCompleted === held) {
          this.heldCompleted = null
          this.options.emitUnscoped(
            `[step-log] end marker for step ${step} did not arrive within ${this.holdTimeoutMs}ms; releasing step.completed\n`,
          )
          this.releaseStepCompleted(held)
        }
      }, this.holdTimeoutMs),
    }
    held.timer.unref?.()
    // A second step.completed cannot arrive while one is held (the executor
    // is sequential), but release a previous hold defensively.
    if (this.heldCompleted) {
      const previous = this.heldCompleted
      clearTimeout(previous.timer)
      this.releaseStepCompleted(previous)
    }
    this.heldCompleted = held
  }

  private releaseStepCompleted(held: HeldStepCompleted): void {
    this.archiver.flushStep(
      typeof held.event.payload.step === 'string' ? held.event.payload.step : '',
    )
    this.forwardWithFinalLog(held.event, held.forward)
  }

  private forwardWithFinalLog(
    event: EccRuntimeProtocolPayload,
    forward: (event: EccRuntimeProtocolPayload) => void,
  ): void {
    const step = typeof event.payload.step === 'string' ? event.payload.step : ''
    const tool = typeof event.payload.tool === 'string' ? event.payload.tool : ''
    forward({
      ...event,
      payload: {
        ...event.payload,
        finalLog: this.archiver.tail(step, tool, this.finalLogBytes),
      },
    })
  }

  private releaseBufferedSegments(key: string): void {
    const queue = this.bufferedSegments.get(key)
    if (!queue) return
    this.bufferedSegments.delete(key)
    for (const segment of queue) {
      this.emitSegment(segment)
    }
  }

  private emitSegment(segment: StepLogSegment): void {
    const event = this.synthesizeStepLog(segment)
    if (event) {
      this.options.emitProtocolEvent(event)
    }
  }

  private synthesizeStepLog(segment: StepLogSegment): EccRuntimeProtocolPayload | null {
    const context = this.operationContext
    if (!context) {
      // No operation identity to attach: the bytes are archived, only the
      // live event is dropped.
      return null
    }
    return {
      eventId: randomUUID(),
      kind: context.kind,
      operationId: context.operationId,
      origin: context.origin,
      payload: {
        chunk: segment.chunk,
        cursor: segment.cursor,
        step: segment.step,
        tool: segment.tool,
      },
      rerun: context.rerun,
      runSessionId: context.runSessionId,
      runtimeInstanceId: context.runtimeInstanceId,
      sequence: this.lastSequence,
      timestamp: Date.now(),
      type: 'step.log',
      workspaceId: context.workspaceId,
    }
  }
}
