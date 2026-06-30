import { describe, expect, it, vi } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import {
  compactResourceMessage,
  formatResourceSize,
  managedInstallLocation,
  primaryActionForRow,
  resourceToRow,
  removalActionForRow,
  rowActionForStatus,
  selectedResourceMetaText,
  runBatchDownload,
  createPrimaryActionTask,
  canImportLocalResource,
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
      message: 'Downloading ICsprout 55nm PDK post-install asset 1/7: ics55_LLSC_H7CH_liberty.tar.bz2',
    })

    expect(row.statusKind).toBe('installing')
    expect(row.statusText).toBe('Downloading')
    expect(row).not.toHaveProperty('statusIcon')
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
    expect(row.statusText).toBe('Post-install')
    expect(row).not.toHaveProperty('statusIcon')
  })

  it('keeps backend error details compact in visible row copy', () => {
    const error = 'Failed to download https://github.com/openecos-projects/icsprout55-pdk/archive/refs/tags/v1.10.100.tar.gz: fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout)'
    const row = resourceToRow(
      resource({
        status: 'error',
        description: '',
        path: null,
        error,
      }),
      undefined,
    )

    expect(row.statusKind).toBe('error')
    expect(row.statusText).toBe('Error')
    expect(row.description).toBe('Connection timeout')
    expect(row.description).not.toContain('https://')
    expect(row.description).not.toContain('UND_ERR')
    expect(row.descriptionTitle).toBe(error)
  })

  it('prefers compact error summaries over registry descriptions on failed rows', () => {
    const error = 'Failed to download https://github.com/openecos-projects/icsprout55-pdk/archive/refs/tags/v1.10.100.tar.gz: fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout)'
    const row = resourceToRow(
      resource({
        status: 'error',
        description: 'Integrated Circuit Systems 55nm PDK',
        path: null,
        error,
      }),
      undefined,
    )

    expect(row.description).toBe('Connection timeout')
    expect(row.descriptionTitle).toBe(error)
  })

  it('compacts verbose resource messages for visible alerts', () => {
    expect(
      compactResourceMessage(
        'Failed to download https://github.com/openecos-projects/icsprout55-pdk/archive/refs/tags/v1.10.100.tar.gz: fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout)',
      ),
    ).toBe('Connection timeout')
    expect(compactResourceMessage('Failed to download https://example.invalid/archive.tar.gz: fetch failed')).toBe('Download failed')
    expect(compactResourceMessage('Checksum mismatch')).toBe('Checksum mismatch')
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

  it('maps local unmanaged tools with install action to replace rows', async () => {
    const installResource = vi.fn(async () => undefined)
    const updateResource = vi.fn(async () => undefined)
    const row = resourceToRow(
      resource({
        id: 'tool:yosys',
        type: 'tool',
        name: 'yosys',
        display_name: 'Yosys',
        description: 'RTL synthesis',
        category: 'synthesis',
        status: 'installed',
        installed_version: '0.66+154',
        available_versions: ['2026-05-13'],
        active_version: '0.66+154',
        active: true,
        path: '/tmp/oss-cad-suite',
        managed_root: '/home/user/.local/share/ecos-studio/tools',
        source: 'local',
        actions: ['install', 'remove_reference'],
        health: { managed: false },
      }),
      undefined,
    )

    expect(row.statusKind).toBe('installed')
    expect(row.statusText).toBe('Local')
    expect(rowActionForStatus(row.resource)).toBe('replace')
    expect(primaryActionForRow(row)).toBe('replace')
    expect(removalActionForRow(row)).toBe('remove_reference')
    expect(selectedResourceMetaText(row)).toBe('Replace with managed v2026-05-13')

    await createPrimaryActionTask(row, { installResource, updateResource })

    expect(installResource).toHaveBeenCalledWith('tool:yosys')
    expect(updateResource).not.toHaveBeenCalled()
  })

  it('maps local unmanaged tools without install action to removable local rows', () => {
    const row = resourceToRow(
      resource({
        id: 'tool:yosys',
        type: 'tool',
        name: 'yosys',
        display_name: 'Yosys',
        description: 'RTL synthesis',
        category: 'synthesis',
        status: 'installed',
        installed_version: '0.66+154',
        available_versions: ['2026-05-13'],
        active_version: '0.66+154',
        active: true,
        path: '/tmp/oss-cad-suite',
        managed_root: '/home/user/.local/share/ecos-studio/tools',
        source: 'local',
        actions: ['remove_reference'],
        health: { managed: false },
      }),
      undefined,
    )

    expect(row.statusText).toBe('Local')
    expect(rowActionForStatus(row.resource)).toBe('remove_reference')
    expect(primaryActionForRow(row)).toBeNull()
    expect(removalActionForRow(row)).toBe('remove_reference')
  })

  it('maps local unmanaged tools with unknown versions to local rows', () => {
    const row = resourceToRow(
      resource({
        id: 'tool:yosys',
        type: 'tool',
        name: 'yosys',
        display_name: 'Yosys',
        description: 'RTL synthesis',
        category: 'synthesis',
        status: 'installed',
        installed_version: null,
        available_versions: ['2026-05-13'],
        active_version: null,
        active: true,
        path: '/tmp/oss-cad-suite',
        managed_root: '/home/user/.local/share/ecos-studio/tools',
        source: 'local',
        actions: ['install', 'remove_reference'],
        health: { managed: false },
      }),
      undefined,
    )

    expect(row.version).toBe('Local')
    expect(row.statusText).toBe('Local')
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

  it('allows local import for tool and PDK rows that are not currently mutating', () => {
    expect(
      canImportLocalResource(resourceToRow(resource({
        id: 'tool:yosys',
        type: 'tool',
        status: 'available',
        actions: ['install'],
      }), undefined)),
    ).toBe(true)
    expect(
      canImportLocalResource(resourceToRow(resource({
        id: 'pdk:ics55',
        type: 'pdk',
        status: 'available',
        actions: ['install'],
      }), undefined)),
    ).toBe(true)
    expect(
      canImportLocalResource(resourceToRow(resource({
        id: 'tool:yosys',
        type: 'tool',
        status: 'installing',
        actions: [],
      }), undefined)),
    ).toBe(false)
    expect(
      canImportLocalResource(resourceToRow(resource({
        id: 'tool:yosys',
        type: 'tool',
        status: 'uninstalling',
        actions: [],
      }), undefined)),
    ).toBe(false)
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
