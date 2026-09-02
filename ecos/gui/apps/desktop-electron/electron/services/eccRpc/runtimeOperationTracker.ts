import type { EccRuntimeOperation, EccRuntimeProtocolPayload } from '@ecos-studio/shared'

interface OperationWaiter {
  reject(reason: unknown): void
  resolve(operation: EccRuntimeOperation): void
}

const terminalStates = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
const activeStates = new Set(['queued', 'running'])

/**
 * Keeps the notification-derived operation state separate from RPC session
 * ownership. Notifications may be replayed, so terminal state and waiters are
 * both idempotent.
 */
export class RuntimeOperationTracker {
  private readonly active = new Map<string, EccRuntimeOperation>()
  private readonly latestSequences = new Map<string, number>()
  private readonly terminalOperations = new Map<string, EccRuntimeOperation>()
  private readonly waiters = new Map<string, OperationWaiter[]>()

  hasActiveOperations(): boolean {
    return this.active.size > 0
  }

  firstActiveOperationId(): string | null {
    return this.active.keys().next().value ?? null
  }

  activeOperations(): EccRuntimeOperation[] {
    return [...this.active.values()]
  }

  hasTerminalOperation(operationId: string): boolean {
    return this.terminalOperations.has(operationId)
  }

  track(protocolEvent: EccRuntimeProtocolPayload): boolean {
    const rerunPrepared =
      protocolEvent.type === 'execution.progress' &&
      protocolEvent.payload.sourceType === 'operation.rerun_prepared'
    if (protocolEvent.type !== 'operation.changed' && !rerunPrepared) return false
    const latestSequence = this.latestSequences.get(protocolEvent.operationId)
    if (latestSequence !== undefined && protocolEvent.sequence <= latestSequence) {
      return false
    }
    if (rerunPrepared) {
      const active = this.active.get(protocolEvent.operationId)
      const workspaceRevision =
        protocolEvent.payload.workspaceRevision ?? protocolEvent.workspaceRevision
      if (!active || typeof workspaceRevision !== 'number') return false
      this.latestSequences.set(protocolEvent.operationId, protocolEvent.sequence)
      this.active.set(protocolEvent.operationId, {
        ...active,
        updatedAt: protocolEvent.timestamp,
        workspaceRevision,
      })
      return false
    }
    this.latestSequences.set(protocolEvent.operationId, protocolEvent.sequence)
    const state = stringPayloadValue(protocolEvent.payload, 'state')
    if (activeStates.has(state)) {
      if (this.terminalOperations.has(protocolEvent.operationId)) return false
      this.active.set(protocolEvent.operationId, operationFrom(protocolEvent))
      return false
    }
    if (!terminalStates.has(state)) return false

    this.active.delete(protocolEvent.operationId)
    const operation = operationFrom(protocolEvent)
    this.terminalOperations.set(operation.operationId, operation)
    if (this.terminalOperations.size > 512) {
      const oldestOperationId = this.terminalOperations.keys().next().value!
      this.terminalOperations.delete(oldestOperationId)
      this.latestSequences.delete(oldestOperationId)
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
    this.active.clear()
  }

  reset(reason: Error): void {
    this.rejectAll(reason)
    this.terminalOperations.clear()
    this.latestSequences.clear()
  }

  private resolveWaiters(operationId: string, operation: EccRuntimeOperation): void {
    const waiters = this.waiters.get(operationId)
    if (!waiters) return
    this.waiters.delete(operationId)
    for (const waiter of waiters) waiter.resolve(operation)
  }
}

export function isRuntimeProtocolPayload(
  value: unknown,
): value is EccRuntimeProtocolPayload {
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

function operationFrom(protocolEvent: EccRuntimeProtocolPayload): EccRuntimeOperation {
  const payload = protocolEvent.payload
  const error = isRuntimeErrorPayload(payload.error)
    ? payload.error
    : payload.state === 'cancelled'
      ? { code: 'cancelled', message: 'ECC operation cancelled.' }
      : null
  return {
    cancelRequested: payload.state === 'cancelled' || Boolean(payload.cancelRequested),
    createdAt: protocolEvent.timestamp,
    currentStep: stringPayloadValue(payload, 'step'),
    currentTool: stringPayloadValue(payload, 'tool'),
    error,
    kind: protocolEvent.kind ?? 'step',
    operationId: protocolEvent.operationId,
    origin: protocolEvent.origin,
    rerun: Boolean(protocolEvent.rerun),
    ...(protocolEvent.runSessionId ? { runSessionId: protocolEvent.runSessionId } : {}),
    ...(protocolEvent.runtimeInstanceId
      ? { runtimeInstanceId: protocolEvent.runtimeInstanceId }
      : {}),
    result: recordPayloadValue(payload, 'result'),
    state: stringPayloadValue(payload, 'state') as EccRuntimeOperation['state'],
    step: stringPayloadValue(payload, 'step'),
    updatedAt: protocolEvent.timestamp,
    ...(typeof (payload.workspaceRevision ?? protocolEvent.workspaceRevision) === 'number'
      ? {
          workspaceRevision: (payload.workspaceRevision ??
            protocolEvent.workspaceRevision) as number,
        }
      : {}),
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
