import { describe, expect, it, vi } from 'vitest'

const resourcesBridge = vi.hoisted(() => ({
  activatePdk: vi.fn(),
  cancel: vi.fn(),
  get: vi.fn(),
  importPdkPath: vi.fn(),
  install: vi.fn(),
  list: vi.fn(),
  onProgress: vi.fn(),
  refreshRegistry: vi.fn(),
  removePdkReference: vi.fn(),
  uninstall: vi.fn(),
  update: vi.fn(),
  validatePdk: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => ({
    resources: resourcesBridge,
  }),
}))

import {
  cancelResourceApi,
  importPdkPathApi,
  resourceJobToInstallProgress,
  resourceListToResources,
  resourceListToTools,
  resourceToResourceItem,
  subscribeResourceProgress,
  type ResourceList,
} from './plugin'

describe('Resource Manager tool API adapter', () => {
  const resourceListPayload: ResourceList = {
    diagnostics: [],
    resources: [
      {
        id: 'tool:yosys',
        type: 'tool' as const,
        name: 'yosys',
        display_name: 'Yosys',
        description: 'RTL synthesis',
        category: 'synthesis',
        status: 'installed' as const,
        installed_version: '0.61',
        available_versions: ['0.61'],
        active_version: '0.61',
        active: true,
        path: '/tmp/tools/yosys/0.61',
        managed_root: '/tmp/tools',
        platform: 'linux-x86_64',
        size: 123,
        source: 'registry',
        homepage: 'https://example.com',
        actions: ['uninstall' as const],
        health: {},
        error: null,
      },
      {
        id: 'pdk:ics55',
        type: 'pdk' as const,
        name: 'ics55',
        display_name: 'ics55',
        description: '',
        category: 'pdk',
        status: 'installed' as const,
        installed_version: null,
        available_versions: [],
        active_version: null,
        active: false,
        path: '/tmp/pdk',
        managed_root: null,
        platform: null,
        size: null,
        source: 'local',
        homepage: '',
        actions: ['validate' as const, 'activate' as const],
        health: { imported_at: '2026-05-13T00:00:00Z' },
        error: null,
      },
    ],
  }

  it('maps Resource Manager tool resources to legacy tool rows', () => {
    const tools = resourceListToTools(resourceListPayload)

    expect(tools).toEqual([
      {
        name: 'yosys',
        display_name: 'Yosys',
        description: 'RTL synthesis',
        category: 'synthesis',
        status: 'installed',
        installed_version: '0.61',
        available_versions: ['0.61'],
        install_path: '/tmp/tools/yosys/0.61',
      },
    ])
  })

  it('preserves PDK rows from the unified Resource Manager response', () => {
    const resources = resourceListToResources(resourceListPayload)

    expect(resources.map((resource) => resource.id)).toEqual(['tool:yosys', 'pdk:ics55'])
    expect(resources[1]).toMatchObject({
      id: 'pdk:ics55',
      type: 'pdk',
      actions: ['validate', 'activate'],
      health: { imported_at: '2026-05-13T00:00:00Z' },
    })
  })

  it('preserves Resource Manager PDK resources for resource views', () => {
    const resources = resourceListToResources({
      diagnostics: [],
      resources: [
        {
          id: 'pdk:ics55',
          type: 'pdk' as const,
          name: 'ics55',
          display_name: 'ICSPROUT 55nm PDK',
          description: 'Integrated Circuit Systems 55nm PDK',
          category: 'pdk',
          status: 'available' as const,
          installed_version: null,
          available_versions: ['1.01'],
          active_version: null,
          active: false,
          path: null,
          managed_root: '/home/user/.local/share/ecos-studio/pdks',
          platform: 'all-platform',
          size: 432000000,
          source: 'registry',
          homepage: 'https://example.com/ics55',
          actions: ['install' as const],
          health: {},
          error: null,
        },
      ],
    })

    expect(resources).toEqual([
      {
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
        homepage: 'https://example.com/ics55',
        actions: ['install'],
        health: {},
        error: null,
      },
    ])
  })

  it('clones a resource row for resource views', () => {
    const resource = resourceListPayload.resources[1]

    expect(resourceToResourceItem(resource)).toEqual(resource)
    expect(resourceToResourceItem(resource)).not.toBe(resource)
  })

  it('maps imported backend PDK resources into resource items', () => {
    const item = resourceToResourceItem({
      id: 'pdk:local55',
      type: 'pdk',
      name: 'local55',
      display_name: 'Local 55nm',
      description: '',
      category: 'pdk',
      status: 'installed',
      installed_version: null,
      available_versions: [],
      active_version: null,
      active: false,
      path: '/tmp/pdks/local55',
      managed_root: null,
      platform: null,
      size: null,
      source: 'local',
      homepage: '',
      actions: ['validate', 'activate', 'remove_reference'],
      health: { managed: false },
      error: null,
    })

    expect(item.id).toBe('pdk:local55')
    expect(item.type).toBe('pdk')
    expect(item.actions).toContain('remove_reference')
  })

  it('imports manual PDK paths through the desktop resource bridge', async () => {
    const imported = {
      id: 'pdk:local55',
      type: 'pdk' as const,
      name: 'local55',
      display_name: 'Local 55nm',
      description: '',
      category: 'pdk',
      status: 'installed' as const,
      installed_version: null,
      available_versions: [],
      active_version: null,
      active: false,
      path: '/tmp/pdks/local55',
      managed_root: null,
      platform: null,
      size: null,
      source: 'local',
      homepage: '',
      actions: ['validate' as const, 'activate' as const, 'remove_reference' as const],
      health: { managed: false },
      error: null,
    }
    resourcesBridge.importPdkPath.mockResolvedValue(imported)

    await expect(importPdkPathApi('/tmp/pdks/local55')).resolves.toEqual(imported)

    expect(resourcesBridge.importPdkPath).toHaveBeenCalledWith({
      path: '/tmp/pdks/local55',
    })
  })

  it('cancels resource jobs through the desktop resource bridge', async () => {
    resourcesBridge.cancel.mockResolvedValue({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })

    await expect(cancelResourceApi('tool:yosys')).resolves.toEqual({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })

    expect(resourcesBridge.cancel).toHaveBeenCalledWith('tool:yosys')
  })

  it('subscribes to resource progress through the desktop event bridge', () => {
    const unsubscribe = vi.fn()
    let listener: ((job: Parameters<Parameters<typeof subscribeResourceProgress>[1]>[0]) => void) | undefined
    resourcesBridge.onProgress.mockImplementation((callback) => {
      listener = callback
      return unsubscribe
    })
    const onProgress = vi.fn()

    const subscription = subscribeResourceProgress('tool:yosys', onProgress)

    listener?.({
      id: 'job-ignored',
      resource_id: 'pdk:ics55',
      action: 'install',
      phase: 'downloading',
      progress: 0.2,
      message: 'Downloading PDK',
      error: null,
    } as never)
    listener?.({
      id: 'job-1',
      resource_id: 'tool:yosys',
      action: 'install',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
      error: null,
    } as never)
    subscription.close()

    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith({
      resourceId: 'tool:yosys',
      resourceName: 'yosys',
      tool: 'yosys',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
    })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('maps Resource Manager jobs to install progress rows', () => {
    expect(
      resourceJobToInstallProgress({
        id: 'job-1',
        resource_id: 'tool:yosys',
        action: 'install',
        phase: 'downloading',
        progress: 0.5,
        message: 'Downloading...',
        error: null,
      }),
    ).toEqual({
      resourceId: 'tool:yosys',
      resourceName: 'yosys',
      tool: 'yosys',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
    })
  })

  it('maps PDK jobs to install progress rows with resource identity', () => {
    expect(
      resourceJobToInstallProgress({
        id: 'job-2',
        resource_id: 'pdk:ics55',
        action: 'install',
        phase: 'downloading',
        progress: 0.25,
        message: 'Downloading...',
        error: null,
      }),
    ).toEqual({
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'downloading',
      progress: 0.25,
      message: 'Downloading...',
    })
  })
})
