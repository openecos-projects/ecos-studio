import { describe, expect, it } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import { resourceToRow } from './pluginToolsRows'
import {
  buildSidebarItems,
  buildStatusTabs,
  filterResourceRows,
  frontendReadiness,
  isInstalledLikeRow,
} from './pluginManagerFilters'

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

function rows() {
  return [
    resourceToRow(resource({}), undefined),
    resourceToRow(
      resource({
        id: 'tool:verilator',
        name: 'verilator',
        display_name: 'Verilator',
        description: 'SystemVerilog simulator',
        status: 'installed',
        installed_version: '5.050',
        actions: ['uninstall'],
      }),
      undefined,
    ),
    resourceToRow(
      resource({
        id: 'pdk:ics55',
        type: 'pdk',
        name: 'ics55',
        display_name: 'ICS55',
        category: 'pdk',
        status: 'update_available',
        installed_version: '1.01',
        available_versions: ['1.10.102'],
        actions: ['update', 'uninstall'],
      }),
      undefined,
    ),
  ]
}

describe('pluginManagerFilters', () => {
  it('filters by category', () => {
    const all = rows()
    expect(
      filterResourceRows(all, { category: 'all', status: 'all', query: '' }),
    ).toHaveLength(3)
    expect(
      filterResourceRows(all, { category: 'pdks', status: 'all', query: '' }).map(
        (row) => row.id,
      ),
    ).toEqual(['pdk:ics55'])
    expect(
      filterResourceRows(all, { category: 'tools', status: 'all', query: '' }).map(
        (row) => row.id,
      ),
    ).toEqual(['tool:yosys', 'tool:verilator'])
    expect(
      filterResourceRows(all, { category: 'installed', status: 'all', query: '' }).map(
        (row) => row.id,
      ),
    ).toEqual(['tool:verilator', 'pdk:ics55'])
  })

  it('filters by status tab', () => {
    const all = rows()
    expect(
      filterResourceRows(all, { category: 'all', status: 'available', query: '' }).map(
        (row) => row.id,
      ),
    ).toEqual(['tool:yosys'])
    expect(
      filterResourceRows(all, { category: 'all', status: 'updates', query: '' }).map(
        (row) => row.id,
      ),
    ).toEqual(['pdk:ics55'])
  })

  it('matches the search query against name, description, version, and requires', () => {
    const all = rows()
    expect(
      filterResourceRows(all, { category: 'all', status: 'all', query: 'simulator' }).map(
        (row) => row.id,
      ),
    ).toEqual(['tool:verilator'])
    expect(
      filterResourceRows(all, { category: 'all', status: 'all', query: '5.050' }).map(
        (row) => row.id,
      ),
    ).toEqual(['tool:verilator'])
    expect(
      filterResourceRows(all, { category: 'all', status: 'all', query: 'nomatch' }),
    ).toHaveLength(0)
  })

  it('builds sidebar items with per-category counts', () => {
    const items = buildSidebarItems(rows())
    expect(items.map((item) => [item.id, item.count])).toEqual([
      ['all', 3],
      ['frontend', 2],
      ['tools', 2],
      ['pdks', 1],
      ['mpc', 0],
      ['installed', 2],
    ])
  })

  it('builds status tabs with badges', () => {
    const tabs = buildStatusTabs(rows())
    expect(tabs.map((tab) => [tab.id, tab.badge])).toEqual([
      ['all', 0],
      ['available', 1],
      ['installed', 2],
      ['updates', 1],
    ])
  })

  it('summarizes frontend flow readiness per stage', () => {
    const summary = frontendReadiness(rows())
    expect(summary.totalCount).toBe(2)
    expect(summary.installedCount).toBe(1)
    expect(summary.availableCount).toBe(1)
    expect(summary.items).toEqual([
      { label: 'Review', installed: 0, total: 1, status: 'missing' },
      { label: 'Elab', installed: 0, total: 0, status: 'missing' },
      { label: 'Lint', installed: 1, total: 1, status: 'ready' },
      { label: 'Sim', installed: 1, total: 1, status: 'ready' },
      { label: 'Wave', installed: 0, total: 0, status: 'missing' },
    ])
  })

  it('treats installed and update rows as installed-like', () => {
    const [available, installed, update] = rows()
    expect(isInstalledLikeRow(available)).toBe(false)
    expect(isInstalledLikeRow(installed)).toBe(true)
    expect(isInstalledLikeRow(update)).toBe(true)
  })
})
