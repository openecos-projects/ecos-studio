import {
  SETTINGS_REGISTRY,
  desktopApiEventChannels,
  type DesktopSettingDescriptor,
  type DesktopSettingState,
  type DesktopSettingStatus,
  type DesktopSettingWriteResult,
  type DesktopSettingsValue,
} from '@ecos-studio/shared'

import type { SettingHandler } from './settingsHandlers'

export interface SettingsRegistryServiceOptions {
  /** Deliver a changed-state event to every application window. */
  broadcast(channel: string, payload: DesktopSettingState): void
  handlers: Record<string, SettingHandler>
  /** Whether any ECC runtime still has pending work (restart deferral). */
  isEccRuntimePoolBusy: () => boolean
  settingsStore: {
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(
      key: string,
    ): Promise<T | null>
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function okStatus(displayInfo?: string): DesktopSettingStatus {
  return displayInfo === undefined ? { kind: 'ok' } : { kind: 'ok', displayInfo }
}

function errorFromException(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Apply-failure records, kept per key together with the value that failed, so
 * every list() (any window, any reload) reports the same error status until
 * the value changes again or a later write succeeds.
 */
interface ApplyFailure {
  error: string
  value: string | null
}

/**
 * Transactional write path for registry-owned settings:
 * validate -> persist -> apply, with a changed broadcast after every accepted
 * write so all windows converge (last write wins). Transactions for the same
 * key are serialized so concurrent windows can never interleave a validate,
 * persist, or apply step and broadcast a mixed value/status.
 */
export class SettingsRegistryService {
  private readonly broadcast: SettingsRegistryServiceOptions['broadcast']
  private readonly handlers: Record<string, SettingHandler>
  private readonly isEccRuntimePoolBusy: () => boolean
  private readonly settingsStore: SettingsRegistryServiceOptions['settingsStore']
  /** Keys whose runtime apply was deferred while the ECC pool was busy. */
  private readonly pendingApplyKeys = new Set<string>()
  private readonly applyFailures = new Map<string, ApplyFailure>()
  /** Tail promise of the per-key write transaction queue. */
  private readonly writeQueues = new Map<string, Promise<unknown>>()

  constructor(options: SettingsRegistryServiceOptions) {
    this.broadcast = options.broadcast
    this.handlers = options.handlers
    this.isEccRuntimePoolBusy = options.isEccRuntimePoolBusy
    this.settingsStore = options.settingsStore
  }

  async list(): Promise<DesktopSettingState[]> {
    const states: DesktopSettingState[] = []
    for (const descriptor of SETTINGS_REGISTRY) {
      states.push(await this.stateFor(descriptor))
    }
    return states
  }

  async set(key: unknown, value: unknown): Promise<DesktopSettingWriteResult> {
    if (!isNonEmptyString(key)) {
      return { ok: false, error: '设置项键名必须是非空字符串' }
    }
    const descriptor = this.requireDescriptor(key)
    if (!descriptor) {
      return { ok: false, error: `未知的设置项: ${String(key)}` }
    }
    if (typeof value !== 'string') {
      return { ok: false, error: `设置项 ${key} 的值必须是字符串` }
    }

    const handler = this.handlers[key]
    if (!handler) {
      return { ok: false, error: `设置项 ${key} 没有可用的处理器` }
    }

    return await this.enqueueWrite(key, async () => {
      const validation = await handler.validate(value)
      if (!validation.ok) {
        return { ok: false, error: validation.error }
      }

      try {
        await handler.persist(value)
      } catch (error) {
        // A persistence failure (main-side exception) must surface as a clean
        // rejection without touching state or broadcasting.
        return { ok: false, error: errorFromException(error) }
      }
      return await this.finishWrite(descriptor, async () => {
        const outcome = await handler.apply(value)
        return outcome === 'pending'
          ? { kind: 'pending' }
          : okStatus(validation.displayInfo)
      })
    })
  }

  async reset(key: unknown): Promise<DesktopSettingWriteResult> {
    if (!isNonEmptyString(key)) {
      return { ok: false, error: '设置项键名必须是非空字符串' }
    }
    const descriptor = this.requireDescriptor(key)
    if (!descriptor) {
      return { ok: false, error: `未知的设置项: ${String(key)}` }
    }

    const handler = this.handlers[key]
    if (!handler) {
      return { ok: false, error: `设置项 ${key} 没有可用的处理器` }
    }

    return await this.enqueueWrite(key, async () => {
      try {
        await handler.clear()
      } catch (error) {
        return { ok: false, error: errorFromException(error) }
      }
      return await this.finishWrite(descriptor, async () => {
        const outcome = await handler.apply(null)
        return outcome === 'pending' ? { kind: 'pending' } : { kind: 'ok' }
      })
    })
  }

  /**
   * Re-read and broadcast one key after an out-of-registry write (for example
   * the Codex dependency picker in the AI chat panel) so every window,
   * including the Preferences page, converges on the same value.
   */
  async notifyKeyChanged(key: string): Promise<void> {
    const descriptor = this.requireDescriptor(key)
    if (!descriptor) return
    await this.enqueueWrite(key, async () => {
      const state = await this.stateFor(descriptor)
      this.broadcast(desktopApiEventChannels.settingsRegistryChanged, state)
    })
  }

  /** Run one key's write transaction after any already-queued write for it. */
  private enqueueWrite<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(key) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    this.writeQueues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  private async finishWrite(
    descriptor: DesktopSettingDescriptor,
    computeStatus: () => Promise<DesktopSettingStatus>,
  ): Promise<DesktopSettingWriteResult> {
    let status: DesktopSettingStatus
    try {
      status = await computeStatus()
    } catch (error) {
      status = { kind: 'error', error: errorFromException(error) }
    }
    // Read the persisted value AFTER applying so apply-failure records key off
    // what is actually stored (handlers may canonicalize the input).
    const value = await this.readStoredValue(descriptor.key)
    if (status.kind === 'pending') {
      this.pendingApplyKeys.add(descriptor.key)
    } else if (status.kind === 'error') {
      this.applyFailures.set(descriptor.key, { error: status.error, value })
    } else {
      this.pendingApplyKeys.delete(descriptor.key)
      this.applyFailures.delete(descriptor.key)
    }

    const state: DesktopSettingState = {
      descriptor,
      isDefault: value === null,
      status,
      value,
    }
    this.broadcast(desktopApiEventChannels.settingsRegistryChanged, state)
    return { ok: true, state }
  }

  private async stateFor(
    descriptor: DesktopSettingDescriptor,
  ): Promise<DesktopSettingState> {
    const value = await this.readStoredValue(descriptor.key)
    const status = await this.recomputeStatus(descriptor.key, value)
    return { descriptor, isDefault: value === null, status, value }
  }

  private async recomputeStatus(
    key: string,
    value: string | null,
  ): Promise<DesktopSettingStatus> {
    const failure = this.applyFailures.get(key)
    if (failure && failure.value === value) {
      return { kind: 'error', error: failure.error }
    }
    if (failure) {
      // The stored value moved on from the failed one; the record is stale.
      this.applyFailures.delete(key)
    }

    if (this.pendingApplyKeys.has(key)) {
      if (this.isEccRuntimePoolBusy()) {
        return { kind: 'pending' }
      }
      // The pool drained; the next sidecar start self-applies via launch
      // drift detection, so nothing is deferred anymore.
      this.pendingApplyKeys.delete(key)
    }

    if (value === null) {
      return { kind: 'ok' }
    }
    const handler = this.handlers[key]
    if (!handler) {
      return { kind: 'ok' }
    }
    const validation = await handler.validate(value)
    return validation.ok
      ? okStatus(validation.displayInfo)
      : { kind: 'error', error: validation.error }
  }

  private async readStoredValue(key: string): Promise<string | null> {
    const value = await this.settingsStore.get<string>(key)
    if (typeof value !== 'string' || value.trim() === '') {
      return null
    }
    return value
  }

  private requireDescriptor(key: string): DesktopSettingDescriptor | null {
    return SETTINGS_REGISTRY.find((descriptor) => descriptor.key === key) ?? null
  }
}
