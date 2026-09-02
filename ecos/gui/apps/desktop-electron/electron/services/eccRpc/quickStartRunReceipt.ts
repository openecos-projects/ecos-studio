import type { EccRuntimeEvent } from '@ecos-studio/shared'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TERMINAL_PROTOCOL_TYPES = new Set([
  'operation.cancelled',
  'operation.completed',
  'operation.failed',
])

interface ReconcileOptions {
  now?: () => Date
}

interface TerminalRuntimeEvent {
  error?: string
  occurredAt?: string
  operationId: string
  status: 'flow_completed' | 'flow_failed'
  workspaceDirectory: string
}

export async function reconcileQuickStartRunReceipt(
  event: EccRuntimeEvent,
  options: ReconcileOptions = {},
): Promise<boolean> {
  const terminalEvent = terminalRuntimeEventFrom(event, options)
  if (!terminalEvent) return false

  const path = join(terminalEvent.workspaceDirectory, 'quick_start_run.json')
  let record: unknown
  try {
    record = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return false
  }
  if (!isRecord(record)) return false
  if (record.status !== 'flow_running') return false
  if (!matchesQuickStartOperation(record, terminalEvent.operationId)) return false

  const patch =
    terminalEvent.status === 'flow_completed'
      ? { completed_at: terminalEvent.occurredAt, status: terminalEvent.status }
      : {
          error: terminalEvent.error ?? 'ECC operation failed.',
          failed_at: terminalEvent.occurredAt,
          status: terminalEvent.status,
        }
  await writeFile(
    path,
    `${JSON.stringify({ ...record, ...patch, updated_at: options.now?.().toISOString() ?? new Date().toISOString() }, null, 2)}\n`,
  )
  return true
}

function terminalRuntimeEventFrom(
  event: EccRuntimeEvent,
  options: ReconcileOptions,
): TerminalRuntimeEvent | null {
  if (event.type === 'runtime.protocol') {
    if (!TERMINAL_PROTOCOL_TYPES.has(event.event.type)) return null
    if (!event.workspaceDirectory) return null
    const status =
      event.event.type === 'operation.completed' ? 'flow_completed' : 'flow_failed'
    return {
      error: failureMessageFromProtocol(event),
      occurredAt: isoFromRuntimeTimestamp(event.event.timestamp, options),
      operationId: event.event.operationId,
      status,
      workspaceDirectory: event.workspaceDirectory,
    }
  }

  if (
    event.type !== 'operation.completed' &&
    event.type !== 'operation.failed' &&
    event.type !== 'operation.cancelled'
  ) {
    return null
  }
  if (!event.workspaceDirectory) return null
  return {
    error:
      event.type === 'operation.failed'
        ? event.message
        : event.type === 'operation.cancelled'
          ? 'ECC operation cancelled.'
          : undefined,
    occurredAt: options.now?.().toISOString() ?? new Date().toISOString(),
    operationId: event.operationId,
    status: event.type === 'operation.completed' ? 'flow_completed' : 'flow_failed',
    workspaceDirectory: event.workspaceDirectory,
  }
}

function failureMessageFromProtocol(
  event: Extract<EccRuntimeEvent, { type: 'runtime.protocol' }>,
): string | undefined {
  if (event.event.type === 'operation.cancelled') return 'ECC operation cancelled.'
  const error = event.event.payload.error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return undefined
}

function isoFromRuntimeTimestamp(
  timestamp: number | undefined,
  options: ReconcileOptions,
): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return options.now?.().toISOString() ?? new Date().toISOString()
  }
  return new Date(
    timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp,
  ).toISOString()
}

function matchesQuickStartOperation(
  record: Record<string, unknown>,
  operationId: string,
): boolean {
  if (!isRecord(record.flow)) return false
  return record.flow.operation_id === operationId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
