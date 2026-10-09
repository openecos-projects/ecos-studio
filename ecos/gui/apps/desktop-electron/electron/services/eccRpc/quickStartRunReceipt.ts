import type { EccRuntimeEvent, EccRuntimeOperation } from '@ecos-studio/shared'
import { randomInt } from 'node:crypto'
import { chmod, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const pendingReceipts = new Map<string, Promise<boolean>>()
const TERMINAL_PROTOCOL_STATES = new Set(['succeeded', 'failed', 'cancelled'])

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

export function reconcileQuickStartOperationReceipt(
  operation: EccRuntimeOperation,
  workspaceDirectory: string,
): Promise<boolean> {
  if (
    operation.kind !== 'flow' ||
    !['succeeded', 'failed', 'cancelled'].includes(operation.state)
  ) {
    return Promise.resolve(false)
  }
  return reconcileTerminalReceipt(
    {
      error:
        operation.state === 'cancelled'
          ? 'ECC operation cancelled.'
          : operation.error?.message,
      occurredAt: isoFromRuntimeTimestamp(operation.updatedAt, {}),
      operationId: operation.operationId,
      status: operation.state === 'succeeded' ? 'flow_completed' : 'flow_failed',
      workspaceDirectory,
    },
    {},
  )
}

export function reconcileQuickStartRunReceipt(
  event: EccRuntimeEvent,
  options: ReconcileOptions = {},
): Promise<boolean> {
  const terminalEvent = terminalRuntimeEventFrom(event, options)
  if (!terminalEvent) return Promise.resolve(false)
  return reconcileTerminalReceipt(terminalEvent, options)
}

async function reconcileTerminalReceipt(
  terminalEvent: TerminalRuntimeEvent,
  options: ReconcileOptions,
): Promise<boolean> {
  const path = join(terminalEvent.workspaceDirectory, 'quick_start_run.json')
  const pending = pendingReceipts.get(path) ?? Promise.resolve(false)
  const update = pending
    .catch(() => false)
    .then(() => updateTerminalReceipt(path, terminalEvent, options))
  pendingReceipts.set(path, update)
  try {
    return await update
  } finally {
    if (pendingReceipts.get(path) === update) pendingReceipts.delete(path)
  }
}

async function updateTerminalReceipt(
  path: string,
  terminalEvent: TerminalRuntimeEvent,
  options: ReconcileOptions,
): Promise<boolean> {
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
  await writeTextAtomically(
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
    if (!event.workspaceDirectory) return null
    const state = protocolOperationState(event)
    if (!state || !TERMINAL_PROTOCOL_STATES.has(state)) return null
    return {
      error: failureMessageFromProtocol(event, state),
      occurredAt: isoFromRuntimeTimestamp(event.event.timestamp, options),
      operationId: event.event.operationId,
      status: state === 'succeeded' ? 'flow_completed' : 'flow_failed',
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

function protocolOperationState(
  event: Extract<EccRuntimeEvent, { type: 'runtime.protocol' }>,
): string | undefined {
  if (event.event.type === 'operation.changed') {
    const state = event.event.payload.state
    return typeof state === 'string' ? state : undefined
  }
  if (event.event.type === 'execution.progress') {
    const sourceType = event.event.payload.sourceType
    if (sourceType === 'operation.completed') return 'succeeded'
    if (sourceType === 'operation.failed') return 'failed'
    if (sourceType === 'operation.cancelled') return 'cancelled'
  }
  return undefined
}

function failureMessageFromProtocol(
  event: Extract<EccRuntimeEvent, { type: 'runtime.protocol' }>,
  state: string,
): string | undefined {
  if (state === 'cancelled') return 'ECC operation cancelled.'
  const error = event.event.payload.error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return undefined
}

async function writeTextAtomically(path: string, content: string): Promise<void> {
  const parent = dirname(path)
  const canonicalParent = await realpath(parent)
  let mode: number | undefined
  try {
    mode = (await stat(path)).mode & 0o777
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${randomInt(0, 1_000_000)}.tmp`
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    if (mode !== undefined) {
      await chmod(temporaryPath, mode)
    }
    if ((await realpath(parent)) !== canonicalParent) {
      throw new Error(
        `Refusing to write ${path}: parent directory changed during the write`,
      )
    }
    await rename(temporaryPath, path)
  } catch (error) {
    if ((await realpath(parent).catch(() => '')) === canonicalParent) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
    throw error
  }
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
