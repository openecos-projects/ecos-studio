import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DesktopSettingState, DesktopSettingWriteResult } from '@ecos-studio/shared'

import { getOptionalDesktopApi } from '@/platform/desktop'

const BRIDGE_UNAVAILABLE_ERROR = 'ECOS desktop bridge is not available.'

function replaceEntry(
  entries: DesktopSettingState[],
  next: DesktopSettingState,
): DesktopSettingState[] {
  const index = entries.findIndex((entry) => entry.descriptor.key === next.descriptor.key)
  if (index === -1) {
    return [...entries, next]
  }
  const updated = [...entries]
  updated[index] = next
  return updated
}

function errorFromException(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Renderer cache for the desktop settings registry. Writes are optimistic with
 * rollback on failure; main stays the single source of truth and broadcasts
 * changed states so multiple windows converge.
 */
export const useSettingsRegistryStore = defineStore('settingsRegistry', () => {
  const entries = ref<DesktopSettingState[]>([])
  const loading = ref(false)
  const validatingKeys = ref<string[]>([])
  /** Last rejected write per key, shown inline until the value changes again. */
  const rowErrors = ref<Record<string, string>>({})
  let unsubscribeChanged: (() => void) | null = null
  /** Supersedence tracking so a stale list snapshot never overwrites live updates. */
  let loadSeq = 0
  let liveUpdateCount = 0

  function noteLiveUpdate(): void {
    liveUpdateCount += 1
  }

  function isValidating(key: string): boolean {
    return validatingKeys.value.includes(key)
  }

  function errorFor(key: string): string {
    return rowErrors.value[key] ?? ''
  }

  function entryFor(key: string): DesktopSettingState | null {
    return entries.value.find((entry) => entry.descriptor.key === key) ?? null
  }

  async function load(): Promise<void> {
    const api = getOptionalDesktopApi()
    if (!api?.settingsRegistry) return
    const seq = ++loadSeq
    const liveAtStart = liveUpdateCount
    loading.value = true
    try {
      const result = await api.settingsRegistry.list()
      // A changed broadcast (or this window's own write) that landed during the
      // fetch is newer than the snapshot; keep it instead of the stale list.
      if (seq !== loadSeq || liveUpdateCount !== liveAtStart) return
      entries.value = result
    } finally {
      if (seq === loadSeq) {
        loading.value = false
      }
    }
  }

  async function set(key: string, value: string): Promise<DesktopSettingWriteResult> {
    const api = getOptionalDesktopApi()
    if (!api?.settingsRegistry) {
      return { ok: false, error: BRIDGE_UNAVAILABLE_ERROR }
    }

    const previous = entryFor(key)
    if (previous) {
      entries.value = replaceEntry(entries.value, { ...previous, value })
    }
    validatingKeys.value = [...validatingKeys.value, key]
    try {
      let result: DesktopSettingWriteResult
      try {
        result = await api.settingsRegistry.set({ key, value })
      } catch (error) {
        // Main-side exceptions (disk failures, inventory errors, ...) cross the
        // bridge as thrown errors; surface them like an ordinary rejection.
        result = { ok: false, error: errorFromException(error) }
      }
      if (result.ok) {
        entries.value = replaceEntry(entries.value, result.state)
        delete rowErrors.value[key]
        noteLiveUpdate()
      } else {
        rowErrors.value[key] = result.error
        // Only undo our optimistic write if no newer value (for example a
        // last-write-wins broadcast from another window) replaced it meanwhile.
        if (previous && entryFor(key)?.value === value) {
          entries.value = replaceEntry(entries.value, previous)
        }
      }
      return result
    } finally {
      validatingKeys.value = validatingKeys.value.filter((candidate) => candidate !== key)
    }
  }

  async function reset(key: string): Promise<DesktopSettingWriteResult> {
    const api = getOptionalDesktopApi()
    if (!api?.settingsRegistry) {
      return { ok: false, error: BRIDGE_UNAVAILABLE_ERROR }
    }

    validatingKeys.value = [...validatingKeys.value, key]
    try {
      let result: DesktopSettingWriteResult
      try {
        result = await api.settingsRegistry.reset({ key })
      } catch (error) {
        result = { ok: false, error: errorFromException(error) }
      }
      if (result.ok) {
        entries.value = replaceEntry(entries.value, result.state)
        delete rowErrors.value[key]
        noteLiveUpdate()
      } else {
        rowErrors.value[key] = result.error
      }
      return result
    } finally {
      validatingKeys.value = validatingKeys.value.filter((candidate) => candidate !== key)
    }
  }

  /** Subscribe to cross-window changed broadcasts while the page is open. */
  function bindChangedEvents(): void {
    const api = getOptionalDesktopApi()
    if (!api?.settingsRegistry || unsubscribeChanged) return
    unsubscribeChanged = api.settingsRegistry.onChanged((state) => {
      entries.value = replaceEntry(entries.value, state)
      delete rowErrors.value[state.descriptor.key]
      noteLiveUpdate()
    })
  }

  function unbindChangedEvents(): void {
    unsubscribeChanged?.()
    unsubscribeChanged = null
  }

  return {
    bindChangedEvents,
    entries,
    entryFor,
    errorFor,
    isValidating,
    load,
    loading,
    reset,
    set,
    unbindChangedEvents,
    validatingKeys,
  }
})
