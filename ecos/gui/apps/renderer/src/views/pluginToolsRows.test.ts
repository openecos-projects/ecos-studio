import { describe, expect, it } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import { formatResourceSize, resourceToRow, rowActionForStatus } from './pluginToolsRows'

function resource(overrides: Partial<ResourceItem>): ResourceItem {
  return {
    id: 'pdk:ics55',
    type: 'pdk',
    name: 'ics55',
    display_name: 'ICSPROUT 55nm PDK',
    description: 'Integrated Circuit Systems 55nm PDK',
    category: 'pdk',
    status: 'available',
    installed_version: null,
    available_versions: ['1.01'],
    active_version: null,
    active: false,
    path: null,
    platform: 'all-platform',
    size: 432000000,
    source: 'registry',
    homepage: '',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

describe('pluginToolsRows', () => {
  it('maps an available registry PDK to an installable row', () => {
    const row = resourceToRow(resource({}), undefined)

    expect(row).toMatchObject({
      id: 'pdk:ics55',
      type: 'pdk',
      name: 'ICSPROUT 55nm PDK',
      version: 'v1.01',
      sizeLabel: '412 MB',
      sizeMb: 412,
      statusKind: 'available',
      statusText: 'Available',
    })
  })

  it('maps active managed PDK to installed row', () => {
    const row = resourceToRow(
      resource({
        status: 'installed',
        installed_version: '1.01',
        active_version: '1.01',
        active: true,
        path: '/tmp/pdks/ics55/1.01',
        actions: ['validate', 'uninstall'],
        health: { managed: true },
      }),
      undefined,
    )

    expect(row.statusKind).toBe('installed')
    expect(row.statusText).toBe('Active')
    expect(row.version).toBe('v1.01')
  })

  it('maps progress to installing state', () => {
    const row = resourceToRow(resource({ status: 'installing' }), {
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
    })

    expect(row.statusKind).toBe('installing')
    expect(row.statusText).toBe('Downloading 50%')
    expect(row.progressPercent).toBe(50)
  })

  it('formats resource sizes from bytes', () => {
    expect(formatResourceSize(null)).toEqual({ sizeLabel: '0 MB', sizeMb: 0 })
    expect(formatResourceSize(432000000)).toEqual({ sizeLabel: '412 MB', sizeMb: 412 })
    expect(formatResourceSize(2 * 1024 * 1024 * 1024)).toEqual({ sizeLabel: '2.00 GB', sizeMb: 2048 })
  })

  it('chooses actions from resource action list', () => {
    expect(rowActionForStatus(resource({ status: 'available', actions: ['install'] }))).toBe('install')
    expect(rowActionForStatus(resource({ status: 'update_available', actions: ['update'] }))).toBe('update')
    expect(rowActionForStatus(resource({ status: 'installed', actions: ['uninstall'] }))).toBe('uninstall')
    expect(rowActionForStatus(resource({ status: 'installed', actions: ['remove_reference'] }))).toBe('remove_reference')
  })
})
