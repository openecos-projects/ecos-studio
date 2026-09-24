import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import type { ResourceItem } from '@/api/plugin'
import { resourceToRow } from '@/views/pluginToolsRows'
import type { ResourceRow } from '@/views/pluginToolsRows'
import { usePluginSelection } from './usePluginSelection'

function resource(overrides: Partial<ResourceItem>): ResourceItem {
  return {
    id: 'tool:yosys',
    type: 'tool',
    name: 'yosys',
    display_name: 'Yosys',
    description: 'Open synthesis suite',
    category: 'synthesis',
    status: 'available',
    installed_version: null,
    available_versions: ['20260827'],
    active_version: null,
    active: false,
    path: null,
    managed_root: null,
    platform: 'linux-x86_64',
    size: null,
    source: 'registry',
    homepage: '',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

function rowFor(id: string, status: ResourceItem['status']): ResourceRow {
  return resourceToRow(
    resource({
      id,
      name: id.replace(/^tool:/, ''),
      status,
      installed_version: status === 'installed' ? '1.0' : null,
      actions: status === 'available' ? ['install'] : ['uninstall'],
    }),
    undefined,
  )
}

function setup(initialRows: ResourceRow[]) {
  const rows = ref<ResourceRow[]>(initialRows)
  const scope = effectScope()
  const selection = scope.run(() => usePluginSelection(rows))!
  return { rows, scope, selection }
}

describe('usePluginSelection', () => {
  it('pre-selects up to two actionable rows when the initial selection is empty', async () => {
    const { selection, scope } = setup([
      rowFor('tool:a', 'update_available'),
      rowFor('tool:b', 'installing'),
      rowFor('tool:c', 'update_available'),
      rowFor('tool:d', 'available'),
    ])
    await nextTick()

    expect([...selection.selectedIds.value]).toEqual(['tool:a', 'tool:b'])
    scope.stop()
  })

  it('keeps an explicit selection instead of applying defaults', async () => {
    const { rows, selection, scope } = setup([])
    await nextTick()
    expect(selection.selectedIds.value.size).toBe(0)

    rows.value = [rowFor('tool:a', 'update_available'), rowFor('tool:b', 'available')]
    await nextTick()
    expect([...selection.selectedIds.value]).toEqual(['tool:a'])

    selection.toggle('tool:a')
    selection.toggle('tool:b')
    expect([...selection.selectedIds.value]).toEqual(['tool:b'])

    rows.value = [
      rowFor('tool:a', 'update_available'),
      rowFor('tool:b', 'available'),
      rowFor('tool:c', 'update_available'),
    ]
    await nextTick()

    expect([...selection.selectedIds.value]).toEqual(['tool:b'])
    scope.stop()
  })

  it('prunes selection entries whose rows disappeared', async () => {
    const { rows, selection, scope } = setup([])
    await nextTick()

    rows.value = [rowFor('tool:a', 'available'), rowFor('tool:b', 'available')]
    await nextTick()
    selection.toggle('tool:a')
    selection.toggle('tool:b')

    rows.value = [rowFor('tool:b', 'available')]
    await nextTick()

    expect([...selection.selectedIds.value]).toEqual(['tool:b'])
    scope.stop()
  })

  it('falls back to defaults when pruning empties the selection', async () => {
    const { rows, selection, scope } = setup([])
    await nextTick()

    rows.value = [rowFor('tool:a', 'available')]
    await nextTick()
    selection.toggle('tool:a')

    rows.value = [rowFor('tool:c', 'update_available')]
    await nextTick()

    expect([...selection.selectedIds.value]).toEqual(['tool:c'])
    scope.stop()
  })

  it('remove only drops the given id', async () => {
    const { rows, selection, scope } = setup([])
    await nextTick()

    rows.value = [rowFor('tool:a', 'available'), rowFor('tool:b', 'available')]
    await nextTick()
    selection.toggle('tool:a')
    selection.toggle('tool:b')
    selection.remove('tool:a')

    expect(selection.isSelected('tool:a')).toBe(false)
    expect(selection.isSelected('tool:b')).toBe(true)
    scope.stop()
  })
})
