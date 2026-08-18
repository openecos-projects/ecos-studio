import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { isPathWithinRoot } from '../pathScope'

/**
 * Client-side archiver for the ecc step marker protocol (v1).
 *
 * The sidecar never writes step log files; it writes bytes to fd 2 plus step
 * markers. This archiver consumes the sidecar's stderr stream, switches
 * archive files on matched markers, and writes per-step logs to
 * `<workspace>/<Step>_<tool>/log/<Step>.log`. Matched markers are consumed
 * and never archived or forwarded.
 */

export const STEP_MARKER_PREFIX = Buffer.from('\x1eECC-STEP ', 'utf8')
export const STEP_MARKER_VERSION = 1

const MARKER_HOLDBACK_BYTES = 512
const DEFAULT_BATCH_BYTES = 16 * 1024
const DEFAULT_BATCH_WINDOW_MS = 100
const DEFAULT_TAIL_BYTES = 64 * 1024

export interface StepLogStepRef {
  step: string
  tool: string
}

export interface StepLogSegment extends StepLogStepRef {
  chunk: string
  cursor: number
}

export interface StepMarker extends StepLogStepRef {
  event: string
}

export interface StepLogArchiverOptions {
  workspaceDirectory: string
  onSegment: (segment: StepLogSegment) => void
  onStepEnded: (step: StepLogStepRef) => void
  onUnscoped: (text: string) => void
  onProtocolViolation?: (reason: string) => void
  batchBytes?: number
  batchWindowMs?: number
  tailBytes?: number
}

interface ActiveStepArchive extends StepLogStepRef {
  archiveOk: boolean
  cursor: number
  path: string
  pendingBytes: number
  pendingChunks: Buffer[]
}

interface TailChunks {
  bytes: number
  chunks: Buffer[]
}

export function stepLogKey(step: string, tool: string): string {
  return JSON.stringify([step, tool])
}

export function parseStepMarker(line: Buffer): StepMarker | null {
  if (line.length < STEP_MARKER_PREFIX.length) return null
  if (!line.subarray(0, STEP_MARKER_PREFIX.length).equals(STEP_MARKER_PREFIX)) return null
  let payload = line.subarray(STEP_MARKER_PREFIX.length)
  if (payload.length > 0 && payload[payload.length - 1] === 0x0a) {
    payload = payload.subarray(0, payload.length - 1)
  }
  let data: unknown
  try {
    data = JSON.parse(payload.toString('utf8'))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  if (record.v !== STEP_MARKER_VERSION) return null
  if (
    typeof record.event !== 'string' ||
    typeof record.step !== 'string' ||
    typeof record.tool !== 'string'
  ) {
    return null
  }
  return { event: record.event, step: record.step, tool: record.tool }
}

export function readFlowJsonStepAllowlist(workspaceDirectory: string): Set<string> {
  const keys = new Set<string>()
  try {
    const raw = readFileSync(join(workspaceDirectory, 'home', 'flow.json'), 'utf8')
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return keys
    const steps = (data as { steps?: unknown }).steps
    if (!Array.isArray(steps)) return keys
    for (const record of steps) {
      if (typeof record !== 'object' || record === null) continue
      const name = (record as { name?: unknown }).name
      const tool = (record as { tool?: unknown }).tool
      if (typeof name === 'string' && typeof tool === 'string') {
        keys.add(stepLogKey(name, tool))
      }
    }
  } catch {
    // A missing or malformed flow.json yields an empty allowlist: every
    // marker degrades to ordinary bytes until the next refresh.
  }
  return keys
}

function isSafeMarkerName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('..')
  )
}

function archivePathContained(archivePath: string, workspaceDirectory: string): boolean {
  if (!isPathWithinRoot(archivePath, workspaceDirectory)) return false
  // A symlinked step or log directory inside the workspace would otherwise
  // pass the textual check: resolve the deepest existing ancestor.
  let ancestor = dirname(archivePath)
  for (;;) {
    if (existsSync(ancestor)) {
      try {
        const resolved = join(realpathSync(ancestor), basename(archivePath))
        return isPathWithinRoot(resolved, realpathSync(workspaceDirectory))
      } catch {
        return false
      }
    }
    const parent = dirname(ancestor)
    if (parent === ancestor) return false
    ancestor = parent
  }
}

export class StepLogArchiver {
  private readonly batchBytes: number
  private readonly batchWindowMs: number
  private readonly tailBytes: number
  private allowlist = new Set<string>()
  private active: ActiveStepArchive | null = null
  private buffer = Buffer.alloc(0)
  private flushTimer: NodeJS.Timeout | null = null
  private readonly tails = new Map<string, TailChunks>()

  constructor(private readonly options: StepLogArchiverOptions) {
    this.batchBytes = options.batchBytes ?? DEFAULT_BATCH_BYTES
    this.batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS
    this.tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES
  }

  refreshAllowlist(keys: Iterable<string>): void {
    this.allowlist = new Set(keys)
  }

  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    this.processBuffer()
  }

  flushStep(step: string): void {
    if (this.active?.step === step) {
      this.flushActive()
    }
  }

  tail(step: string, tool: string, maxBytes?: number): string {
    const tail = this.tails.get(stepLogKey(step, tool))
    if (!tail) return ''
    const limit = maxBytes ?? this.tailBytes
    const combined = Buffer.concat(tail.chunks, tail.bytes)
    return combined.subarray(Math.max(0, combined.length - limit)).toString('utf8')
  }

  close(): void {
    // Bytes held back by the parser (an incomplete final line, possibly a
    // truncated marker candidate) are still stream bytes: route them like
    // any other data instead of discarding them.
    if (this.buffer.length > 0) {
      this.emitData(this.buffer)
      this.buffer = Buffer.alloc(0)
    }
    this.clearFlushTimer()
    const active = this.active
    if (active?.archiveOk && active.pendingBytes > 0) {
      try {
        appendFileSync(
          active.path,
          Buffer.concat(active.pendingChunks, active.pendingBytes),
        )
      } catch (error) {
        this.options.onProtocolViolation?.(
          `archive flush on close failed: ${String(error)}`,
        )
      }
    }
    this.active = null
  }

  /**
   * Abandon the active step without emitting StepEnded: flush its pending
   * bytes to the archive and clear the active state, so a later begin for
   * any step starts a fresh attempt instead of reading as nested. Used when
   * the step's end marker never arrives (lost or crashed producer).
   */
  abandonActiveStep(): void {
    const active = this.active
    if (!active) return
    this.clearFlushTimer()
    if (active.archiveOk && active.pendingBytes > 0) {
      try {
        appendFileSync(
          active.path,
          Buffer.concat(active.pendingChunks, active.pendingBytes),
        )
      } catch (error) {
        this.options.onProtocolViolation?.(
          `archive flush on abandon failed: ${String(error)}`,
        )
      }
    }
    this.active = null
  }

  private processBuffer(): void {
    for (;;) {
      const candidate = this.buffer.indexOf(STEP_MARKER_PREFIX)
      if (candidate < 0) {
        // No candidate frame: hold back only a trailing partial prefix.
        const tail = this.buffer.lastIndexOf(STEP_MARKER_PREFIX[0]!)
        if (tail >= 0) {
          const suffix = this.buffer.subarray(tail)
          if (
            suffix.length <= STEP_MARKER_PREFIX.length &&
            STEP_MARKER_PREFIX.subarray(0, suffix.length).equals(suffix)
          ) {
            if (tail > 0) {
              this.emitData(this.buffer.subarray(0, tail))
            }
            this.buffer = this.buffer.subarray(tail)
            return
          }
        }
        if (this.buffer.length > 0) {
          this.emitData(this.buffer)
        }
        this.buffer = Buffer.alloc(0)
        return
      }
      if (candidate > 0) {
        // Bytes before a marker candidate are ordinary stream data.
        this.emitData(this.buffer.subarray(0, candidate))
        this.buffer = this.buffer.subarray(candidate)
        continue
      }
      const newline = this.buffer.indexOf(0x0a)
      if (newline < 0) {
        if (this.buffer.length < MARKER_HOLDBACK_BYTES) {
          return
        }
        // An overlong candidate without a newline is not a marker: emit the
        // prefix's first byte and rescan the remainder.
        this.emitData(this.buffer.subarray(0, 1))
        this.buffer = this.buffer.subarray(1)
        continue
      }
      const frame = this.buffer.subarray(0, newline + 1)
      this.buffer = this.buffer.subarray(newline + 1)
      const marker = parseStepMarker(frame)
      if (marker) {
        this.handleMarker(marker, frame)
      } else {
        this.emitData(frame)
      }
    }
  }

  private handleMarker(marker: StepMarker, rawLine: Buffer): void {
    if (marker.event === 'begin') {
      if (
        !this.allowlist.has(stepLogKey(marker.step, marker.tool)) ||
        this.active !== null
      ) {
        this.emitData(rawLine)
        return
      }
      if (!isSafeMarkerName(marker.step) || !isSafeMarkerName(marker.tool)) {
        this.options.onProtocolViolation?.(
          `unsafe step marker name: ${marker.step}/${marker.tool}`,
        )
        this.emitData(rawLine)
        return
      }
      const archivePath = join(
        this.options.workspaceDirectory,
        `${marker.step}_${marker.tool}`,
        'log',
        `${marker.step}.log`,
      )
      if (!archivePathContained(archivePath, this.options.workspaceDirectory)) {
        this.options.onProtocolViolation?.(
          `archive path escapes workspace: ${archivePath}`,
        )
        this.emitData(rawLine)
        return
      }
      this.activate(marker, archivePath)
      return
    }
    if (marker.event === 'end' && this.matchesActive(marker)) {
      const ended = this.active!
      this.flushActive()
      this.active = null
      this.options.onStepEnded({ step: ended.step, tool: ended.tool })
      return
    }
    this.emitData(rawLine)
  }

  private matchesActive(marker: StepMarker): boolean {
    return (
      this.active !== null &&
      marker.event === 'end' &&
      marker.step === this.active.step &&
      marker.tool === this.active.tool
    )
  }

  private activate(marker: StepMarker, archivePath: string): void {
    let archiveOk = true
    try {
      mkdirSync(dirname(archivePath), { recursive: true })
      // Truncate on begin: a rerun starts a fresh byte stream with cursor 0.
      writeFileSync(archivePath, Buffer.alloc(0))
    } catch (error) {
      this.options.onProtocolViolation?.(`archive open failed: ${String(error)}`)
      archiveOk = false
    }
    this.active = {
      archiveOk,
      cursor: 0,
      path: archivePath,
      pendingBytes: 0,
      pendingChunks: [],
      step: marker.step,
      tool: marker.tool,
    }
    this.tails.set(stepLogKey(marker.step, marker.tool), { bytes: 0, chunks: [] })
  }

  private emitData(data: Buffer): void {
    const active = this.active
    if (!active) {
      this.options.onUnscoped(data.toString('utf8'))
      return
    }
    const key = stepLogKey(active.step, active.tool)
    let tail = this.tails.get(key)
    if (!tail) {
      tail = { bytes: 0, chunks: [] }
      this.tails.set(key, tail)
    }
    // Copy the line: storing parser subarrays would pin whole stream chunks.
    const copy = Buffer.from(data)
    tail.chunks.push(copy)
    tail.bytes += copy.length
    while (tail.bytes > this.tailBytes && tail.chunks.length > 1) {
      tail.bytes -= tail.chunks.shift()!.length
    }
    if (!active.archiveOk) {
      // The archive was abandoned after an earlier write failure; the memory
      // tail still serves finalLog.
      return
    }
    active.pendingChunks.push(data)
    active.pendingBytes += data.length
    if (active.pendingBytes >= this.batchBytes) {
      this.flushActive()
    } else {
      this.scheduleFlush()
    }
  }

  private flushActive(): void {
    const active = this.active
    this.clearFlushTimer()
    if (!active || active.pendingBytes === 0) return
    const chunk = Buffer.concat(active.pendingChunks, active.pendingBytes)
    active.pendingChunks = []
    active.pendingBytes = 0
    try {
      appendFileSync(active.path, chunk)
    } catch (error) {
      this.options.onProtocolViolation?.(`archive write failed: ${String(error)}`)
      active.archiveOk = false
      return
    }
    active.cursor += chunk.length
    this.options.onSegment({
      chunk: chunk.toString('utf8'),
      cursor: active.cursor,
      step: active.step,
      tool: active.tool,
    })
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushActive()
    }, this.batchWindowMs)
    this.flushTimer.unref?.()
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return
    clearTimeout(this.flushTimer)
    this.flushTimer = null
  }
}
