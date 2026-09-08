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
 * Transactional write path for registry-owned settings:
 * validate -> persist -> apply, with a changed broadcast after every accepted
 * write so all windows converge (last write wins).
 */
export class SettingsRegistryService {
  private readonly broadcast: SettingsRegistryServiceOptions['broadcast']
  private readonly handlers: Record<string, SettingHandler>
  private readonly isEccRuntimePoolBusy: () => boolean
  private readonly pendingApplyKeys = new Set<string>()
  private readonly settingsStore: SettingsRegistryServiceOptions['settingsStore']

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

    const validation = await handler.validate(value)
    if (!validation.ok) {
      return { ok: false, error: validation.error }
    }

    await handler.persist(value)

    let status: DesktopSettingStatus
    try {
      const outcome = await handler.apply(value)
      if (outcome === 'pending') {
        this.pendingApplyKeys.add(key)
        status = { kind: 'pending' }
      } else {
        this.pendingApplyKeys.delete(key)
        status = okStatus(validation.displayInfo)
      }
    } catch (error) {
      status = { kind: 'error', error: errorFromException(error) }
    }

    return await this.finishWrite(descriptor, status)
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

    await handler.clear()

    let status: DesktopSettingStatus
    try {
      const outcome = await handler.apply(null)
      this.pendingApplyKeys.delete(key)
      status = outcome === 'pending' ? { kind: 'pending' } : { kind: 'ok' }
    } catch (error) {
      status = { kind: 'error', error: errorFromException(error) }
    }

    return await this.finishWrite(descriptor, status)
  }

  /**
   * Re-read and broadcast one key after an out-of-registry write (for example
   * the Codex dependency picker in the AI chat panel) so every window,
   * including the Preferences page, converges on the same value.
   */
  async notifyKeyChanged(key: string): Promise<void> {
    const descriptor = this.requireDescriptor(key)
    if (!descriptor) return
    const state = await this.stateFor(descriptor)
    this.broadcast(desktopApiEventChannels.settingsRegistryChanged, state)
  }

  private async finishWrite(
    descriptor: DesktopSettingDescriptor,
    status: DesktopSettingStatus,
  ): Promise<DesktopSettingWriteResult> {
    const value = await this.readStoredValue(descriptor.key)
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
    if (value === null) {
      return { descriptor, isDefault: true, status: { kind: 'ok' }, value: null }
    }
    return {
      descriptor,
      isDefault: false,
      status: await this.recomputeStatus(descriptor.key, value),
      value,
    }
  }

  private async recomputeStatus(
    key: string,
    value: string,
  ): Promise<DesktopSettingStatus> {
    if (this.pendingApplyKeys.has(key)) {
      if (this.isEccRuntimePoolBusy()) {
        return { kind: 'pending' }
      }
      // The pool drained; the next sidecar start self-applies via launch
      // drift detection, so nothing is deferred anymore.
      this.pendingApplyKeys.delete(key)
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
