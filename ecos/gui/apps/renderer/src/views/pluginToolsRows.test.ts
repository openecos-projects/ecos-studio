import { describe, expect, it, vi } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import {
  formatResourceSize,
  managedInstallLocation,
  primaryActionForRow,
  resourceToRow,
  rowActionForStatus,
  runBatchDownload,
} from './pluginToolsRows'

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
    managed_root: '/home/user/.local/share/ecos-studio/pdks',
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

  it('maps post-install progress to initializing state', () => {
    const row = resourceToRow(resource({ status: 'installing' }), {
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'post_install',
      progress: 0,
      message: 'Running PDK post-install steps...',
    })

    expect(row.statusKind).toBe('installing')
    expect(row.statusText).toBe('Running PDK post-install steps...')
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
    expect(rowActionForStatus(resource({ status: 'installing', actions: [] }))).toBe('cancel')
    expect(rowActionForStatus(resource({ status: 'uninstalling', actions: ['uninstall'] }))).toBe('none')
    expect(rowActionForStatus(resource({ status: 'removing', actions: ['remove_reference'] }))).toBe('none')
  })

  it('identifies rows with primary download actions', () => {
    expect(
      primaryActionForRow(
        resourceToRow(resource({ status: 'available', actions: ['install'] }), undefined),
      ),
    ).toBe('install')
    expect(
      primaryActionForRow(
        resourceToRow(resource({ status: 'update_available', actions: ['update'] }), undefined),
      ),
    ).toBe('update')
    expect(
      primaryActionForRow(
        resourceToRow(
          resource({
            status: 'installed',
            source: 'local',
            actions: ['validate', 'remove_reference'],
          }),
          undefined,
        ),
      ),
    ).toBeNull()
  })

  it('runs batch download for selected available PDKs and updateable tools', async () => {
    const installResource = vi.fn(async () => undefined)
    const updateResource = vi.fn(async () => undefined)

    const rows = [
      resourceToRow(resource({ id: 'pdk:ics55', status: 'available', actions: ['install'] }), undefined),
      resourceToRow(
        resource({
          id: 'tool:yosys',
          type: 'tool',
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          status: 'update_available',
          installed_version: '0.60',
          available_versions: ['0.61'],
          platform: 'linux-x86_64',
          size: 123,
          managed_root: '/home/user/.local/share/ecos-studio/tools',
          source: 'registry',
          actions: ['update', 'uninstall'],
        }),
        undefined,
      ),
      resourceToRow(
        resource({
          id: 'pdk:local55',
          status: 'installed',
          source: 'local',
          path: '/tmp/pdks/local55',
          actions: ['validate', 'remove_reference'],
        }),
        undefined,
      ),
    ]

    await runBatchDownload(rows, {
      installResource,
      updateResource,
    })

    expect(installResource).toHaveBeenCalledTimes(1)
    expect(installResource).toHaveBeenCalledWith('pdk:ics55')
    expect(updateResource).toHaveBeenCalledTimes(1)
    expect(updateResource).toHaveBeenCalledWith('tool:yosys')
  })

  it('derives managed install location from downloadable resource types', () => {
    const installablePdk = resourceToRow(
      resource({ id: 'pdk:ics55', status: 'available', actions: ['install'] }),
      undefined,
    )
    const installableTool = resourceToRow(
      resource({
        id: 'tool:yosys',
        type: 'tool',
        name: 'yosys',
        display_name: 'Yosys',
        category: 'synthesis',
        status: 'available',
        available_versions: ['0.61'],
        managed_root: '/home/user/.local/share/ecos-studio/tools',
        actions: ['install'],
      }),
      undefined,
    )

    expect(managedInstallLocation([installablePdk])).toBe(
      '/home/user/.local/share/ecos-studio/pdks/ics55/1.01',
    )
    expect(managedInstallLocation([installableTool])).toBe(
      '/home/user/.local/share/ecos-studio/tools/yosys/0.61',
    )
    expect(managedInstallLocation([installableTool, installablePdk])).toBe(
      '/home/user/.local/share/ecos-studio/tools/yosys/0.61, /home/user/.local/share/ecos-studio/pdks/ics55/1.01',
    )
    expect(managedInstallLocation([])).toBe('')
  })
})
