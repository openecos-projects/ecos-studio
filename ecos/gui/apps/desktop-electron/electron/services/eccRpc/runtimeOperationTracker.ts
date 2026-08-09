import type { EccRuntimeOperation, EccRuntimeProtocolPayload } from '@ecos-studio/shared'

interface OperationWaiter {
  reject(reason: unknown): void
  resolve(operation: EccRuntimeOperation): void
}

const terminalEventTypes = new Set([
  'operation.completed',
  'operation.failed',
  'operation.cancelled',
])

/**
 * Keeps the notification-derived operation state separate from RPC session
 * ownership. Notifications may be replayed, so terminal state and waiters are
 * both idempotent.
 */
export class RuntimeOperationTracker {
  private readonly activeOperationIds = new Set<string>()
  private readonly terminalOperations = new Map<string, EccRuntimeOperation>()
  private readonly waiters = new Map<string, OperationWaiter[]>()

  hasActiveOperations(): boolean {
    return this.activeOperationIds.size > 0
  }

  firstActiveOperationId(): string | null {
    return this.activeOperationIds.values().next().value ?? null
  }

  track(protocolEvent: EccRuntimeProtocolPayload): boolean {
    if (!terminalEventTypes.has(protocolEvent.type)) {
      if (this.terminalOperations.has(protocolEvent.operationId)) return false
      this.activeOperationIds.add(protocolEvent.operationId)
      return false
    }

    this.activeOperationIds.delete(protocolEvent.operationId)
    const operation = terminalOperationFrom(protocolEvent)
    this.terminalOperations.set(operation.operationId, operation)
    if (this.terminalOperations.size > 512) {
      this.terminalOperations.delete(this.terminalOperations.keys().next().value!)
    }
    this.resolveWaiters(operation.operationId, operation)
    return true
  }

  waitFor(operationId: string): Promise<EccRuntimeOperation> {
    const completed = this.terminalOperations.get(operationId)
    if (completed) return Promise.resolve(completed)

    return new Promise<EccRuntimeOperation>((resolve, reject) => {
      const waiters = this.waiters.get(operationId) ?? []
      waiters.push({ reject, resolve })
      this.waiters.set(operationId, waiters)

      // A notification can arrive between the lookup and waiter registration.
      const terminal = this.terminalOperations.get(operationId)
      if (terminal) this.resolveWaiters(operationId, terminal)
    })
  }

  rejectAll(reason: Error): void {
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter.reject(reason)
    }
    this.waiters.clear()
    this.activeOperationIds.clear()
  }

  reset(reason: Error): void {
    this.rejectAll(reason)
    this.terminalOperations.clear()
  }

  private resolveWaiters(operationId: string, operation: EccRuntimeOperation): void {
    const waiters = this.waiters.get(operationId)
    if (!waiters) return
    this.waiters.delete(operationId)
    for (const waiter of waiters) waiter.resolve(operation)
  }
}

export function isRuntimeProtocolPayload(value: unknown): value is EccRuntimeProtocolPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const event = value as Record<string, unknown>
  return (
    typeof event.eventId === 'string' &&
    typeof event.operationId === 'string' &&
    typeof event.workspaceId === 'string' &&
    typeof event.sequence === 'number' &&
    typeof event.type === 'string' &&
    typeof event.payload === 'object' &&
    event.payload !== null &&
    !Array.isArray(event.payload)
  )
}

function terminalOperationFrom(protocolEvent: EccRuntimeProtocolPayload): EccRuntimeOperation {
  const payload = protocolEvent.payload
  const error = isRuntimeErrorPayload(payload.error)
    ? payload.error
    : protocolEvent.type === 'operation.cancelled'
      ? { code: 'cancelled', message: 'ECC operation cancelled.' }
      : null
  return {
    awaitingEventId: null,
    cancelRequested: protocolEvent.type === 'operation.cancelled',
    createdAt: protocolEvent.timestamp,
    currentStep: stringPayloadValue(payload, 'step'),
    currentTool: stringPayloadValue(payload, 'tool'),
    error,
    kind: protocolEvent.kind ?? 'step',
    operationId: protocolEvent.operationId,
    origin: protocolEvent.origin,
    rerun: Boolean(protocolEvent.rerun),
    result: recordPayloadValue(payload, 'result'),
    state:
      protocolEvent.type === 'operation.completed'
        ? 'succeeded'
        : protocolEvent.type === 'operation.cancelled'
          ? 'cancelled'
          : 'failed',
    step: stringPayloadValue(payload, 'step'),
    updatedAt: protocolEvent.timestamp,
    workspaceId: protocolEvent.workspaceId,
  }
}

function stringPayloadValue(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === 'string' ? payload[key] : ''
}

function recordPayloadValue(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = payload[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isRuntimeErrorPayload(
  value: unknown,
): value is { code: string; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  )
}
