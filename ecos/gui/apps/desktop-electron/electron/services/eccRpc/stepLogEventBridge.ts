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

interface PendingTerminalEvent {
  event: EccRuntimeProtocolPayload
  forward: (event: EccRuntimeProtocolPayload) => void
}

interface HeldTerminalEvent extends PendingTerminalEvent {
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
  private pendingTerminal: PendingTerminalEvent | null = null
  private heldTerminal: HeldTerminalEvent | null = null

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
    this.archiver.refreshAllowlist(
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
      // Most recently observed wins: replays can carry older values and a
      // restarted sidecar restarts its own sequence. Ordering within a step
      // is carried by payload.cursor, not by sequence.
      this.lastSequence = event.sequence
    }
    if (event.type === 'operation.started') {
      // The previous operation's leftovers resolve before this start: its
      // held step.completed releases now (ecc only allows a new operation
      // after the previous one went terminal, so that end marker can no
      // longer arrive), then its queued terminal event forwards.
      const held = this.heldCompleted
      if (held) {
        this.heldCompleted = null
        clearTimeout(held.timer)
        this.archiver.abandonActiveStep()
        this.releaseStepCompleted(held)
      }
      const heldTerminal = this.heldTerminal
      if (heldTerminal) {
        this.heldTerminal = null
        clearTimeout(heldTerminal.timer)
        this.archiver.abandonActiveStep()
        this.bufferedSegments.clear()
        this.operationContext = null
        heldTerminal.forward(heldTerminal.event)
      }
      const staleTerminal = this.pendingTerminal
      if (staleTerminal) {
        this.pendingTerminal = null
        staleTerminal.forward(staleTerminal.event)
      }
      this.operationContext = {
        kind: event.kind,
        operationId: event.operationId,
        origin: event.origin,
        rerun: event.rerun,
        runSessionId: event.runSessionId,
        runtimeInstanceId: event.runtimeInstanceId,
        workspaceId: event.workspaceId,
      }
      // Segments that arrived before operation.started (the stderr stream
      // races the RPC channel) stay buffered: they belong to this operation
      // and are released by their step.started with the new context.
      this.startedSteps.clear()
      this.endedStepCounts.clear()
      this.completedStepCounts.clear()
      this.refreshAllowlist()
      forward(event)
      return
    }
    if (
      event.type === 'operation.completed' ||
      event.type === 'operation.failed' ||
      event.type === 'operation.cancelled'
    ) {
      if (this.heldCompleted) {
        // The step completion barrier comes first: the terminal event waits
        // for the held step.completed, preserving lifecycle order when the
        // RPC channel races the stderr stream (a failed step does not wait
        // for the render gate, so this race is routine).
        this.pendingTerminal = { event, forward }
        return
      }
      if (this.archiver.activeStep) {
        // The executor can raise after begin without ever emitting a
        // completion or an end marker. Hold the terminal event briefly for
        // the end marker; on timeout the stale archive is abandoned before
        // the terminal forwards, so the next operation starts clean.
        const held: HeldTerminalEvent = {
          event,
          forward,
          timer: setTimeout(() => {
            if (this.heldTerminal === held) {
              this.heldTerminal = null
              this.options.emitUnscoped(
                `[step-log] end marker for step ${this.archiver.activeStep?.step ?? 'unknown'} did not arrive before ${event.type}; releasing after ${this.holdTimeoutMs}ms\n`,
              )
              this.archiver.abandonActiveStep()
              this.bufferedSegments.clear()
              this.operationContext = null
              held.forward(held.event)
            }
          }, this.holdTimeoutMs),
        }
        held.timer.unref?.()
        this.heldTerminal = held
        return
      }
      // Any segment still buffered at a terminal boundary belongs to a step
      // whose step.started never arrived (crash); the archive file holds the
      // bytes, so only synthesis is dropped.
      this.bufferedSegments.clear()
      this.operationContext = null
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
    const held = this.heldCompleted
    if (held) {
      this.heldCompleted = null
      clearTimeout(held.timer)
      this.releaseStepCompleted(held)
    }
    const pending = this.pendingTerminal
    if (pending) {
      this.pendingTerminal = null
      pending.forward(pending.event)
    }
    const heldTerminal = this.heldTerminal
    if (heldTerminal) {
      this.heldTerminal = null
      clearTimeout(heldTerminal.timer)
      heldTerminal.forward(heldTerminal.event)
    }
    this.operationContext = null
    this.lastSequence = 0
    this.startedSteps.clear()
    this.bufferedSegments.clear()
    this.endedStepCounts.clear()
    this.completedStepCounts.clear()
  }

  private handleSegment(segment: StepLogSegment): void {
    const key = stepLogKey(segment.step, segment.tool)
    // Without an operation context (the stderr stream can run ahead of the
    // RPC channel) or before the step's step.started, segments wait in the
    // per-step buffer; the archive file already holds their bytes.
    if (this.operationContext === null || !this.startedSteps.has(key)) {
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
    const heldTerminal = this.heldTerminal
    if (heldTerminal) {
      // The end marker arrived: the archive is complete and the terminal
      // event can forward in lifecycle order.
      this.heldTerminal = null
      clearTimeout(heldTerminal.timer)
      this.bufferedSegments.clear()
      this.operationContext = null
      heldTerminal.forward(heldTerminal.event)
    }
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
    if (event.payload.state === 'Skipped' || event.payload.replayed === true) {
      // Skipped steps return before any marker emission, so no StepEnded
      // will ever arrive for them; render-gate replays re-send an already
      // accounted completion. Neither may be held: forward immediately.
      this.forwardWithFinalLog(event, forward)
      return
    }
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
          this.archiver.abandonActiveStep()
          this.releaseStepCompleted(held)
        }
      }, this.holdTimeoutMs),
    }
    held.timer.unref?.()
    // A second step.completed cannot arrive while one is held (the executor
    // is sequential); if one does, the previous step's end marker was lost,
    // so its hold is released with whatever the tail holds.
    if (this.heldCompleted) {
      const previous = this.heldCompleted
      clearTimeout(previous.timer)
      this.options.emitUnscoped(
        `[step-log] superseded hold for step ${String(previous.event.payload.step)}; its end marker never arrived\n`,
      )
      this.archiver.abandonActiveStep()
      this.releaseStepCompleted(previous)
    }
    this.heldCompleted = held
  }

  private releaseStepCompleted(held: HeldStepCompleted): void {
    const step =
      typeof held.event.payload.step === 'string' ? held.event.payload.step : ''
    const tool =
      typeof held.event.payload.tool === 'string' ? held.event.payload.tool : ''
    this.archiver.flushStep(step)
    // Every forwarded completion consumes one attempt, however it released.
    const key = stepLogKey(step, tool)
    this.completedStepCounts.set(key, (this.completedStepCounts.get(key) ?? 0) + 1)
    this.forwardWithFinalLog(held.event, held.forward)
    const pending = this.pendingTerminal
    if (pending) {
      this.pendingTerminal = null
      this.bufferedSegments.clear()
      this.operationContext = null
      pending.forward(pending.event)
    }
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
