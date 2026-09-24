import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { ResourceRow } from '@/views/pluginToolsRows'

const DEFAULT_SELECTION_LIMIT = 2

/**
 * Tracks the batch-selection set for the resource manager. Selection is pruned
 * whenever the row list changes; when pruning leaves the set empty, up to two
 * rows that are actionable right now (update available or already installing)
 * are pre-selected so the batch Download button stays useful.
 */
export function usePluginSelection(rows: Ref<ResourceRow[]>) {
  const selectedIds = ref<Set<string>>(new Set())

  watch(
    rows,
    (list) => {
      const rowIds = new Set(list.map((row) => row.id))
      const next = new Set([...selectedIds.value].filter((id) => rowIds.has(id)))

      if (next.size === 0) {
        const defaults = list
          .filter((row) => row.statusKind === 'update' || row.statusKind === 'installing')
          .slice(0, DEFAULT_SELECTION_LIMIT)
        for (const row of defaults) {
          next.add(row.id)
        }
      }

      selectedIds.value = next
    },
    { immediate: true },
  )

  function isSelected(id: string): boolean {
    return selectedIds.value.has(id)
  }

  function toggle(id: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function remove(id: string): void {
    const next = new Set(selectedIds.value)
    next.delete(id)
    selectedIds.value = next
  }

  return { selectedIds, isSelected, toggle, remove }
}
