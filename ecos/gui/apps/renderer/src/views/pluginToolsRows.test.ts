import { describe, expect, it, vi } from 'vitest'

import type { ResourceItem } from '@/api/plugin'
import {
  formatResourceSize,
  frontendFlowTagsFor,
  isEdaToolRow,
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
    requires: [],
    installed_requires: [],
    missing_requires: [],
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
    expect(row.isFrontendTool).toBe(false)
    expect(row.flowTags).toEqual([])
  })

  it('marks ECC-FE frontend tool resources with flow tags', () => {
    const yosys = resourceToRow(
      resource({
        id: 'tool:yosys',
        type: 'tool',
        name: 'yosys',
        display_name: 'Yosys',
        description: 'Yosys from the OSS CAD Suite distribution.',
        category: 'synthesis',
        status: 'available',
        available_versions: ['2026-05-13'],
        managed_root: '/home/user/.local/share/ecos-studio/tools',
      }),
      undefined,
    )
    const riscv = resource({
      id: 'tool:riscv-toolchain',
      type: 'tool',
      name: 'riscv-toolchain',
      display_name: 'RISC-V GNU Toolchain',
      description: 'xPack RISC-V bare-metal GCC toolchain.',
      category: 'toolchain',
      status: 'available',
      available_versions: ['15.2.0-1'],
      managed_root: '/home/user/.local/share/ecos-studio/tools',
    })

    expect(yosys.isFrontendTool).toBe(true)
    expect(isEdaToolRow(yosys)).toBe(true)
    expect(yosys.flowTags).toEqual(['Review', 'Yosys', 'Lint', 'Sim'])
    expect(frontendFlowTagsFor(riscv)).toEqual(['CPU Tests', 'CoreMark'])
    expect(isEdaToolRow(resourceToRow(riscv, undefined))).toBe(false)
  })

  it('keeps EDA tool identity separate from ECC-FE frontend flow usage', () => {
    const openroad = resourceToRow(
      resource({
        id: 'tool:openroad',
        type: 'tool',
        name: 'openroad',
        display_name: 'OpenROAD',
        description: 'Digital physical design and place-and-route tool.',
        category: 'place-route',
        status: 'available',
        available_versions: ['2026-06-01'],
        managed_root: '/home/user/.local/share/ecos-studio/tools',
      }),
      undefined,
    )

    expect(openroad.type).toBe('tool')
    expect(openroad.isFrontendTool).toBe(false)
    expect(openroad.flowTags).toEqual([])
    expect(isEdaToolRow(openroad)).toBe(true)
  })

  it('treats ecc-fe as a frontend flow runtime instead of an EDA tool', () => {
    const eccFe = resourceToRow(
      resource({
        id: 'tool:ecc-fe',
        type: 'tool',
        name: 'ecc-fe',
        display_name: 'ECC-FE Frontend Flow',
        description: 'ECOS frontend flow runtime CLI for Review, Elab, Lint, Sim, and Wave integration.',
        category: 'frontend',
        status: 'available',
        available_versions: ['0.1.0-alpha.0-ecos'],
        managed_root: '/home/user/.local/share/ecos-studio/tools',
        requires: ['tool:ecc-fe-soc-ysyx-am'],
        missing_requires: ['tool:ecc-fe-soc-ysyx-am'],
      }),
      undefined,
    )

    expect(eccFe.icon).toBe('FE')
    expect(eccFe.isFrontendTool).toBe(true)
    expect(eccFe.flowTags).toEqual(['Frontend CLI'])
    expect(isEdaToolRow(eccFe)).toBe(false)
    expect(eccFe.dependencyLabel).toBe('Installs 1 required: ecc-fe-soc-ysyx-am')
  })

  it('treats ecc-fe SoC harness resources as frontend resources instead of EDA tools', () => {
    const soc = resourceToRow(
      resource({
        id: 'tool:ecc-fe-soc-ysyx-am',
        type: 'tool',
        name: 'ecc-fe-soc-ysyx-am',
        display_name: 'ECC-FE YSYX AM SoC Harness',
        description: 'Installable SoC harness resource assembled with the ECC-FE frontend flow runtime.',
        category: 'frontend',
        status: 'available',
        available_versions: ['0.1.0-alpha.0-ecos'],
        managed_root: '/home/user/.local/share/ecos-studio/tools',
      }),
      undefined,
    )

    expect(soc.icon).toBe('SOC')
    expect(soc.isFrontendTool).toBe(true)
    expect(soc.flowTags).toContain('SoC Harness')
    expect(isEdaToolRow(soc)).toBe(false)
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

  it('labels imported local PDK references without implying a managed download', () => {
    const inactive = resourceToRow(
      resource({
        status: 'installed',
        source: 'local',
        active: false,
        active_version: null,
        installed_version: null,
        available_versions: [],
        path: '/home/user/pdk/ics55',
        actions: ['validate', 'remove_reference'],
      }),
      undefined,
    )
    const active = resourceToRow(
      resource({
        status: 'installed',
        source: 'local',
        active: true,
        active_version: null,
        installed_version: null,
        available_versions: [],
        path: '/home/user/pdk/ics55',
        actions: ['validate', 'remove_reference'],
      }),
      undefined,
    )

    expect(inactive.statusKind).toBe('installed')
    expect(inactive.statusText).toBe('Local reference')
    expect(inactive.version).toBe('Local')
    expect(active.statusText).toBe('Active local')
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
    expect(formatResourceSize(null)).toEqual({ sizeLabel: '-', sizeMb: 0 })
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

  it('skips selected dependency rows when a selected parent installs them automatically', async () => {
    const installResource = vi.fn(async () => undefined)
    const updateResource = vi.fn(async () => undefined)

    const eccFe = resourceToRow(
      resource({
        id: 'tool:ecc-fe',
        type: 'tool',
        name: 'ecc-fe',
        display_name: 'ECC-FE Frontend Flow',
        description: 'Frontend flow runtime CLI.',
        category: 'frontend',
        status: 'available',
        available_versions: ['0.1.0-alpha.0-ecos'],
        managed_root: '/home/user/.local/share/ecos-studio/tools',
        actions: ['install'],
        requires: ['tool:ecc-fe-soc-ysyx-am'],
        missing_requires: ['tool:ecc-fe-soc-ysyx-am'],
      }),
      undefined,
    )
    const soc = resourceToRow(
      resource({
        id: 'tool:ecc-fe-soc-ysyx-am',
        type: 'tool',
        name: 'ecc-fe-soc-ysyx-am',
        display_name: 'ECC-FE YSYX AM SoC Harness',
        description: 'Frontend SoC harness resource.',
        category: 'frontend',
        status: 'available',
        available_versions: ['0.1.0-alpha.0-ecos'],
        managed_root: '/home/user/.local/share/ecos-studio/tools',
        actions: ['install'],
      }),
      undefined,
    )

    await runBatchDownload([eccFe, soc], {
      installResource,
      updateResource,
    })

    expect(installResource).toHaveBeenCalledTimes(1)
    expect(installResource).toHaveBeenCalledWith('tool:ecc-fe')
    expect(updateResource).not.toHaveBeenCalled()
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
