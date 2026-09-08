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
    loading.value = true
    try {
      entries.value = await api.settingsRegistry.list()
    } finally {
      loading.value = false
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
      const result = await api.settingsRegistry.set({ key, value })
      if (result.ok) {
        entries.value = replaceEntry(entries.value, result.state)
        delete rowErrors.value[key]
      } else {
        rowErrors.value[key] = result.error
        if (previous) {
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

    const previous = entryFor(key)
    validatingKeys.value = [...validatingKeys.value, key]
    try {
      const result = await api.settingsRegistry.reset({ key })
      if (result.ok) {
        entries.value = replaceEntry(entries.value, result.state)
        delete rowErrors.value[key]
      } else {
        rowErrors.value[key] = result.error
        if (previous) {
          entries.value = replaceEntry(entries.value, previous)
        }
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
