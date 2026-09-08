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

interface WriteTicket {
  superseded: boolean
}

/**
 * Renderer cache for the desktop settings registry. Writes are optimistic with
 * rollback on failure; main stays the single source of truth and broadcasts
 * changed states so multiple windows converge (last write wins).
 */
export const useSettingsRegistryStore = defineStore('settingsRegistry', () => {
  const entries = ref<DesktopSettingState[]>([])
  const loading = ref(false)
  const validatingKeys = ref<string[]>([])
  /** Last rejected write per key, shown inline until the value changes again. */
  const rowErrors = ref<Record<string, string>>({})
  let unsubscribeChanged: (() => void) | null = null
  /** One ticket per key with a write in flight; superseded by newer values. */
  const writeTickets = new Map<string, WriteTicket>()
  let loadSeq = 0
  let loadInFlight = false
  /** Live updates that landed while a load was fetching, newer than its snapshot. */
  const liveUpdatesDuringLoad = new Map<string, DesktopSettingState>()

  function isValidating(key: string): boolean {
    return validatingKeys.value.includes(key)
  }

  function errorFor(key: string): string {
    return rowErrors.value[key] ?? ''
  }

  function entryFor(key: string): DesktopSettingState | null {
    return entries.value.find((entry) => entry.descriptor.key === key) ?? null
  }

  function applyLiveUpdate(state: DesktopSettingState): void {
    entries.value = replaceEntry(entries.value, state)
    delete rowErrors.value[state.descriptor.key]
    if (loadInFlight) {
      // Remember it so the in-flight list() snapshot cannot regress it.
      liveUpdatesDuringLoad.set(state.descriptor.key, state)
    }
  }

  async function load(): Promise<void> {
    const api = getOptionalDesktopApi()
    if (!api?.settingsRegistry) return
    const seq = ++loadSeq
    loadInFlight = true
    liveUpdatesDuringLoad.clear()
    loading.value = true
    try {
      const result = await api.settingsRegistry.list()
      if (seq !== loadSeq) return
      entries.value = result
      // Live updates that landed during the fetch may be newer than the
      // snapshot; if the snapshot already contains them the values match.
      for (const state of liveUpdatesDuringLoad.values()) {
        entries.value = replaceEntry(entries.value, state)
      }
    } finally {
      if (seq === loadSeq) {
        loadInFlight = false
        liveUpdatesDuringLoad.clear()
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
    // A newer write to the same key supersedes this one's response.
    const previousTicket = writeTickets.get(key)
    if (previousTicket) previousTicket.superseded = true
    const ticket: WriteTicket = { superseded: false }
    writeTickets.set(key, ticket)
    try {
      let result: DesktopSettingWriteResult
      try {
        result = await api.settingsRegistry.set({ key, value })
      } catch (error) {
        // Main-side exceptions (disk failures, inventory errors, ...) cross the
        // bridge as thrown errors; surface them like an ordinary rejection.
        result = { ok: false, error: errorFromException(error) }
      }
      if (result.ok && !ticket.superseded) {
        entries.value = replaceEntry(entries.value, result.state)
        delete rowErrors.value[key]
      } else if (result.ok) {
        // A broadcast for a newer write already replaced this value.
        delete rowErrors.value[key]
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
      if (writeTickets.get(key) === ticket) {
        writeTickets.delete(key)
      }
      validatingKeys.value = validatingKeys.value.filter((candidate) => candidate !== key)
    }
  }

  async function reset(key: string): Promise<DesktopSettingWriteResult> {
    const api = getOptionalDesktopApi()
    if (!api?.settingsRegistry) {
      return { ok: false, error: BRIDGE_UNAVAILABLE_ERROR }
    }

    validatingKeys.value = [...validatingKeys.value, key]
    const previousTicket = writeTickets.get(key)
    if (previousTicket) previousTicket.superseded = true
    const ticket: WriteTicket = { superseded: false }
    writeTickets.set(key, ticket)
    try {
      let result: DesktopSettingWriteResult
      try {
        result = await api.settingsRegistry.reset({ key })
      } catch (error) {
        result = { ok: false, error: errorFromException(error) }
      }
      if (result.ok && !ticket.superseded) {
        entries.value = replaceEntry(entries.value, result.state)
        delete rowErrors.value[key]
      } else if (result.ok) {
        delete rowErrors.value[key]
      } else {
        rowErrors.value[key] = result.error
      }
      return result
    } finally {
      if (writeTickets.get(key) === ticket) {
        writeTickets.delete(key)
      }
      validatingKeys.value = validatingKeys.value.filter((candidate) => candidate !== key)
    }
  }

  /** Subscribe to cross-window changed broadcasts while the page is open. */
  function bindChangedEvents(): void {
    const api = getOptionalDesktopApi()
    if (!api?.settingsRegistry || unsubscribeChanged) return
    unsubscribeChanged = api.settingsRegistry.onChanged((state) => {
      // A broadcast for a key with a write in flight means that write lost the
      // last-write-wins race; its own successful response must not overwrite.
      const ticket = writeTickets.get(state.descriptor.key)
      if (ticket) ticket.superseded = true
      applyLiveUpdate(state)
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
