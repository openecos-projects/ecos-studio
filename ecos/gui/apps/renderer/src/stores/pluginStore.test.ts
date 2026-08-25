import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PdkInstallationSnapshot } from '@ecos-studio/shared'

vi.mock('@/api/plugin', () => {
  return {
    cancelResourceApi: vi.fn(),
    checkResourceUpdatesApi: vi.fn(),
    importLocalResourcePathApi: vi.fn(),
    installResourceApi: vi.fn(),
    installToolApi: vi.fn(),
    listResourcesApi: vi.fn(),
    listPdkInstallationsApi: vi.fn(async () => []),
    pdkInstallationToResourceItem: vi.fn((installation) => ({
      id: installation.id,
      type: 'pdk',
      name: installation.familyId,
      display_name: installation.displayName,
      description: installation.reason ?? '',
      category: 'pdk',
      status:
        installation.readiness === 'ready' || installation.readiness === 'unverified'
          ? 'installed'
          : installation.readiness,
      installed_version: installation.version,
      available_versions: [],
      active_version: null,
      active: false,
      path: installation.root,
      managed_root: installation.ownership === 'managed' ? installation.root : null,
      platform: null,
      size: null,
      source: installation.ownership,
      homepage: '',
      actions: [installation.ownership === 'managed' ? 'uninstall' : 'remove_reference'],
      health: { readiness: installation.readiness },
      error: installation.reason,
    })),
    removePdkInstallationApi: vi.fn(),
    removePdkReferenceApi: vi.fn(),
    resourceListToTools: (payload: {
      resources: Array<{
        type: string
        name: string
        display_name: string
        description: string
        category: string
        status: string
        installed_version: string | null
        available_versions: string[]
        path: string | null
      }>
    }) =>
      payload.resources
        .filter((resource) => resource.type === 'tool')
        .map((resource) => ({
          name: resource.name,
          display_name: resource.display_name,
          description: resource.description,
          category: resource.category,
          status: resource.status,
          installed_version: resource.installed_version,
          available_versions: resource.available_versions,
          install_path: resource.path,
        })),
    subscribePluginProgress: vi.fn(),
    subscribeResourceProgress: vi.fn(),
    uninstallResourceApi: vi.fn(),
    uninstallToolApi: vi.fn(),
    updateResourceApi: vi.fn(),
    validatePdkApi: vi.fn(),
  }
})

import {
  cancelResourceApi,
  checkResourceUpdatesApi,
  importLocalResourcePathApi,
  installResourceApi,
  listResourcesApi,
  listPdkInstallationsApi,
  removePdkInstallationApi,
  subscribeResourceProgress,
  uninstallResourceApi,
  updateResourceApi,
  type InstallProgress,
  type ResourceItem,
} from '@/api/plugin'
import { usePluginStore } from './pluginStore'

function makeToolResource(overrides: Partial<ResourceItem> = {}): ResourceItem {
  return {
    id: 'tool:yosys',
    type: 'tool',
    name: 'yosys',
    display_name: 'Yosys',
    description: 'RTL synthesis',
    category: 'synthesis',
    status: 'available',
    installed_version: null,
    available_versions: ['0.61'],
    active_version: null,
    active: false,
    path: null,
    managed_root: null,
    platform: 'linux-x86_64',
    size: 123,
    source: 'registry',
    homepage: 'https://example.com/yosys',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

function makePdkResource(overrides: Partial<ResourceItem> = {}): ResourceItem {
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
    managed_root: null,
    platform: 'all-platform',
    size: 432000000,
    source: 'registry',
    homepage: 'https://example.com/ics55',
    actions: ['install'],
    health: {},
    error: null,
    ...overrides,
  }
}

function makePdkInstallation(
  resource: ResourceItem = makePdkResource({
    status: 'installed',
    installed_version: '1.01',
    path: '/tmp/pdks/ics55',
  }),
): PdkInstallationSnapshot {
  return {
    id: resource.id,
    familyId: resource.name,
    displayName: resource.display_name,
    version: resource.installed_version,
    root: resource.path ?? '/tmp/pdks/ics55',
    ownership: resource.source === 'local' ? 'imported' : 'managed',
    readiness: 'ready',
    reason: null,
    supportsEccDefaults: true,
  }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('pluginStore', () => {
  beforeEach(() => {
    vi.useRealTimers()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(cancelResourceApi).mockReset()
    vi.mocked(checkResourceUpdatesApi).mockReset()
    vi.mocked(importLocalResourcePathApi).mockReset()
    vi.mocked(installResourceApi).mockReset()
    vi.mocked(listResourcesApi).mockReset()
    vi.mocked(listPdkInstallationsApi).mockReset()
    vi.mocked(listPdkInstallationsApi).mockResolvedValue([])
    vi.mocked(removePdkInstallationApi).mockReset()
    vi.mocked(subscribeResourceProgress).mockReset()
    vi.mocked(uninstallResourceApi).mockReset()
    vi.mocked(updateResourceApi).mockReset()
  })

  it('fetches unified resources while keeping tools as the legacy tool projection', async () => {
    const unifiedResources = [
      makeToolResource({
        status: 'installed',
        installed_version: '0.61',
        available_versions: ['0.61'],
        path: '/tmp/tools/yosys/0.61',
        actions: ['uninstall'],
      }),
      makePdkResource(),
    ]
    vi.mocked(listResourcesApi).mockResolvedValue(unifiedResources)
    vi.mocked(listPdkInstallationsApi).mockResolvedValue([makePdkInstallation()])

    const store = usePluginStore()
    await store.fetchTools()

    expect(listResourcesApi).toHaveBeenCalledTimes(1)
    expect(store.resources.map((resource) => resource.id)).toEqual([
      'tool:yosys',
      'pdk:ics55',
      'pdk:ics55',
    ])
    expect(store.tools).toEqual([
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

  it('keeps the newest resource list when overlapping fetches resolve out of order', async () => {
    let resolveOlder!: (resources: ResourceItem[]) => void
    let resolveNewer!: (resources: ResourceItem[]) => void
    const older = new Promise<ResourceItem[]>((resolve) => {
      resolveOlder = resolve
    })
    const newer = new Promise<ResourceItem[]>((resolve) => {
      resolveNewer = resolve
    })
    const staleResources = [makeToolResource({ status: 'available' })]
    const currentResources = [
      makeToolResource({
        status: 'installed',
        installed_version: '0.61',
        actions: ['uninstall'],
      }),
    ]
    vi.mocked(listResourcesApi).mockReturnValueOnce(older).mockReturnValueOnce(newer)

    const store = usePluginStore()
    const olderFetch = store.fetchTools()
    const newerFetch = store.fetchTools({ silent: true })

    resolveNewer(currentResources)
    await newerFetch
    expect(store.resources).toEqual(currentResources)

    resolveOlder(staleResources)
    await olderFetch
    expect(store.resources).toEqual(currentResources)
    expect(store.loading).toBe(false)
  })

  it('refreshes the registry, checks rolling updates, and reloads resources', async () => {
    const resources = [makeToolResource()]
    vi.mocked(checkResourceUpdatesApi).mockResolvedValue({
      status: 'ok',
      checked_count: 0,
      update_count: 0,
      diagnostics: [],
      resources: [],
    })
    vi.mocked(listResourcesApi).mockResolvedValue(resources)

    const store = usePluginStore()
    await store.refresh()

    expect(checkResourceUpdatesApi).toHaveBeenCalledWith({
      force: true,
      refreshRegistry: true,
    })
    expect(listResourcesApi).toHaveBeenCalledTimes(1)
    expect(store.resources).toEqual(resources)
    expect(store.refreshing).toBe(false)
  })

  it('installs a PDK resource and subscribes by resourceId', async () => {
    const availablePdk = makePdkResource()
    const installedPdk = makePdkResource({
      status: 'installed',
      installed_version: '1.01',
      path: '/tmp/pdks/ics55',
      actions: ['validate'],
    })
    let onProgress: ((progress: InstallProgress) => void) | undefined
    const close = vi.fn()

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([availablePdk])
      .mockResolvedValueOnce([availablePdk])
    vi.mocked(listPdkInstallationsApi)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makePdkInstallation(installedPdk)])
    vi.mocked(installResourceApi).mockResolvedValue({
      status: 'started',
      resource_id: 'pdk:ics55',
      version: '1.01',
    })
    vi.mocked(subscribeResourceProgress).mockImplementation((resourceId, callback) => {
      expect(resourceId).toBe('pdk:ics55')
      onProgress = callback
      return { close }
    })

    const store = usePluginStore()
    await store.fetchTools()
    await store.installResource('pdk:ics55', '1.01')

    expect(installResourceApi).toHaveBeenCalledWith('pdk:ics55', '1.01')
    expect(subscribeResourceProgress).toHaveBeenCalledTimes(1)
    expect(store.resources[0]?.status).toBe('installing')

    onProgress?.({
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'downloading',
      progress: 0.25,
      message: 'Downloading...',
    })

    expect(store.resourceProgress['pdk:ics55']).toMatchObject({
      resourceId: 'pdk:ics55',
      phase: 'downloading',
      progress: 0.25,
    })
    expect(store.installProgress.ics55).toBeUndefined()

    onProgress?.({
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'done',
      progress: 1,
      message: 'Done',
    })
    await flushMicrotasks()

    expect(close).toHaveBeenCalledTimes(1)
    expect(store.resourceProgress['pdk:ics55']).toBeUndefined()
    expect(store.resourceErrors['pdk:ics55']).toBeUndefined()
    expect(store.resources.find((resource) => resource.path)).toMatchObject({
      id: 'pdk:ics55',
      status: 'installed',
      installed_version: '1.01',
    })
  })

  it('subscribes before starting a resource install so desktop progress events are not missed', async () => {
    const availablePdk = makePdkResource()
    const installedPdk = makePdkResource({
      status: 'installed',
      installed_version: '1.01',
      path: '/tmp/pdks/ics55',
      actions: ['validate'],
    })
    let onProgress: ((progress: InstallProgress) => void) | undefined
    const close = vi.fn()

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([availablePdk])
      .mockResolvedValueOnce([availablePdk])
    vi.mocked(listPdkInstallationsApi)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makePdkInstallation(installedPdk)])
    vi.mocked(subscribeResourceProgress).mockImplementation((resourceId, callback) => {
      expect(resourceId).toBe('pdk:ics55')
      onProgress = callback
      return { close }
    })
    vi.mocked(installResourceApi).mockImplementation(async () => {
      onProgress?.({
        resourceId: 'pdk:ics55',
        resourceName: 'ics55',
        tool: 'ics55',
        phase: 'done',
        progress: 1,
        message: 'Done',
      })
      return {
        status: 'started',
        resource_id: 'pdk:ics55',
        version: '1.01',
      }
    })

    const store = usePluginStore()
    await store.fetchTools()
    await store.installResource('pdk:ics55', '1.01')
    await flushPromises()

    expect(subscribeResourceProgress).toHaveBeenCalledBefore(
      vi.mocked(installResourceApi),
    )
    expect(close).toHaveBeenCalledTimes(1)
    expect(store.resources.find((resource) => resource.path)).toMatchObject({
      id: 'pdk:ics55',
      status: 'installed',
      installed_version: '1.01',
    })
  })

  it('throttles high-frequency resource progress updates while flushing terminal events immediately', async () => {
    vi.useFakeTimers()
    const availablePdk = makePdkResource()
    let onProgress: ((progress: InstallProgress) => void) | undefined
    const close = vi.fn()

    vi.mocked(listResourcesApi).mockResolvedValue([availablePdk])
    vi.mocked(installResourceApi).mockResolvedValue({
      status: 'started',
      resource_id: 'pdk:ics55',
      version: '1.01',
    })
    vi.mocked(subscribeResourceProgress).mockImplementation((_resourceId, callback) => {
      onProgress = callback
      return { close }
    })

    const store = usePluginStore()
    await store.fetchTools()
    await store.installResource('pdk:ics55', '1.01')

    onProgress?.({
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'downloading',
      progress: 0.1,
      message: 'Downloading 10%',
    })
    onProgress?.({
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'downloading',
      progress: 0.2,
      message: 'Downloading 20%',
    })

    expect(store.resourceProgress['pdk:ics55']).toMatchObject({
      progress: 0.1,
      message: 'Downloading 10%',
    })

    await vi.advanceTimersByTimeAsync(180)
    expect(store.resourceProgress['pdk:ics55']).toMatchObject({
      progress: 0.2,
      message: 'Downloading 20%',
    })

    onProgress?.({
      resourceId: 'pdk:ics55',
      resourceName: 'ics55',
      tool: 'ics55',
      phase: 'done',
      progress: 1,
      message: 'Done',
    })
    await flushMicrotasks()

    expect(close).toHaveBeenCalledTimes(1)
    expect(store.resourceProgress['pdk:ics55']).toBeUndefined()
  })

  it('updates a resource by resourceId and syncs legacy tool progress and errors', async () => {
    const updateAvailableTool = makeToolResource({
      status: 'update_available',
      installed_version: '0.60',
      available_versions: ['0.61'],
      actions: ['update', 'uninstall'],
      path: '/tmp/tools/yosys/0.60',
    })
    const erroredTool = makeToolResource({
      status: 'error',
      installed_version: '0.60',
      available_versions: ['0.61'],
      actions: ['update', 'uninstall'],
      error: 'Checksum mismatch',
      path: '/tmp/tools/yosys/0.60',
    })
    let onProgress: ((progress: InstallProgress) => void) | undefined
    const close = vi.fn()

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([updateAvailableTool])
      .mockResolvedValueOnce([erroredTool])
    vi.mocked(updateResourceApi).mockResolvedValue({
      status: 'started',
      resource_id: 'tool:yosys',
      version: '0.61',
    })
    vi.mocked(subscribeResourceProgress).mockImplementation((resourceId, callback) => {
      expect(resourceId).toBe('tool:yosys')
      onProgress = callback
      return { close }
    })

    const store = usePluginStore()
    await store.fetchTools()
    await store.updateResource('tool:yosys')

    expect(updateResourceApi).toHaveBeenCalledWith('tool:yosys')
    expect(store.resources[0]?.status).toBe('installing')
    expect(store.tools[0]?.status).toBe('installing')

    onProgress?.({
      resourceId: 'tool:yosys',
      resourceName: 'yosys',
      tool: 'yosys',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
    })

    expect(store.resourceProgress['tool:yosys']).toMatchObject({
      resourceId: 'tool:yosys',
      phase: 'downloading',
      progress: 0.5,
    })
    expect(store.installProgress.yosys).toMatchObject({
      resourceId: 'tool:yosys',
      phase: 'downloading',
      progress: 0.5,
    })

    onProgress?.({
      resourceId: 'tool:yosys',
      resourceName: 'yosys',
      tool: 'yosys',
      phase: 'error',
      progress: 1,
      message: 'Checksum mismatch',
    })
    await flushPromises()

    expect(close).toHaveBeenCalledTimes(1)
    expect(store.resourceProgress['tool:yosys']).toBeUndefined()
    expect(store.installProgress.yosys).toBeUndefined()
    expect(store.resourceErrors['tool:yosys']).toBe('Checksum mismatch')
    expect(store.toolErrors.yosys).toBe('Checksum mismatch')
    expect(store.tools[0]).toMatchObject({
      name: 'yosys',
      status: 'error',
    })
  })

  it('cancels an active resource install, clears progress, and refreshes resources', async () => {
    const availableTool = makeToolResource()
    const refreshedAvailableTool = makeToolResource()
    const close = vi.fn()
    let onProgress: ((progress: InstallProgress) => void) | undefined
    let rejectInstall: ((error: Error) => void) | undefined

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([availableTool])
      .mockResolvedValueOnce([refreshedAvailableTool])
      .mockResolvedValueOnce([refreshedAvailableTool])
    vi.mocked(installResourceApi).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectInstall = reject
        }),
    )
    vi.mocked(cancelResourceApi).mockResolvedValue({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })
    vi.mocked(subscribeResourceProgress).mockImplementation((_resourceId, callback) => {
      onProgress = callback
      return { close }
    })

    const store = usePluginStore()
    await store.fetchTools()
    const install = store.installResource('tool:yosys', '0.61')
    await flushMicrotasks()

    store.resourceProgress['tool:yosys'] = {
      resourceId: 'tool:yosys',
      resourceName: 'yosys',
      tool: 'yosys',
      phase: 'downloading',
      progress: 0.25,
      message: 'Downloading...',
    }

    await store.cancelResource('tool:yosys')

    expect(cancelResourceApi).toHaveBeenCalledWith('tool:yosys')
    expect(close).not.toHaveBeenCalled()
    expect(store.resourceProgress['tool:yosys']).toBeUndefined()

    onProgress?.({
      resourceId: 'tool:yosys',
      resourceName: 'yosys',
      tool: 'yosys',
      phase: 'cancelled',
      progress: 0,
      message: 'Cancelled download for tool:yosys',
    })
    await flushPromises()
    rejectInstall?.(new Error('Cancelled download for tool:yosys'))
    await install

    expect(close).toHaveBeenCalledTimes(1)
    expect(store.resourceProgress['tool:yosys']).toBeUndefined()
    expect(store.resources[0]).toMatchObject({
      id: 'tool:yosys',
      status: 'available',
    })
  })

  it('does not store an install error when the cancelled install promise rejects', async () => {
    const availableTool = makeToolResource()
    const refreshedAvailableTool = makeToolResource()
    const close = vi.fn()
    let rejectInstall: ((error: Error) => void) | undefined

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([availableTool])
      .mockResolvedValueOnce([refreshedAvailableTool])
    vi.mocked(installResourceApi).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectInstall = reject
        }),
    )
    vi.mocked(cancelResourceApi).mockResolvedValue({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })
    vi.mocked(subscribeResourceProgress).mockReturnValue({ close })

    const store = usePluginStore()
    await store.fetchTools()
    const install = store.installResource('tool:yosys', '0.61')
    await flushMicrotasks()

    await store.cancelResource('tool:yosys')
    rejectInstall?.(new Error('Cancelled download for tool:yosys'))
    await install

    expect(store.resourceErrors['tool:yosys']).toBeUndefined()
    expect(store.toolErrors.yosys).toBeUndefined()
    expect(store.resources[0]).toMatchObject({
      id: 'tool:yosys',
      status: 'available',
      error: null,
    })
  })

  it('does not store an update error when the cancelled update promise rejects', async () => {
    const updateAvailableTool = makeToolResource({
      status: 'update_available',
      installed_version: '0.60',
      available_versions: ['0.61'],
      actions: ['update', 'uninstall'],
    })
    const refreshedUpdateAvailableTool = makeToolResource({
      status: 'update_available',
      installed_version: '0.60',
      available_versions: ['0.61'],
      actions: ['update', 'uninstall'],
    })
    const close = vi.fn()
    let rejectUpdate: ((error: Error) => void) | undefined

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([updateAvailableTool])
      .mockResolvedValueOnce([refreshedUpdateAvailableTool])
    vi.mocked(updateResourceApi).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpdate = reject
        }),
    )
    vi.mocked(cancelResourceApi).mockResolvedValue({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })
    vi.mocked(subscribeResourceProgress).mockReturnValue({ close })

    const store = usePluginStore()
    await store.fetchTools()
    const update = store.updateResource('tool:yosys')
    await flushMicrotasks()

    await store.cancelResource('tool:yosys')
    rejectUpdate?.(new Error('Cancelled download for tool:yosys'))
    await update

    expect(close).toHaveBeenCalledTimes(1)
    expect(store.resourceErrors['tool:yosys']).toBeUndefined()
    expect(store.toolErrors.yosys).toBeUndefined()
    expect(store.resources[0]).toMatchObject({
      id: 'tool:yosys',
      status: 'update_available',
      error: null,
    })
  })

  it('stores uninstall errors by resourceId and restores the previous resource state', async () => {
    const installedPdk = makePdkResource({
      status: 'installed',
      installed_version: '1.01',
      path: '/tmp/pdks/ics55',
      actions: ['uninstall'],
    })

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([makePdkResource()])
      .mockResolvedValueOnce([makePdkResource()])
    vi.mocked(listPdkInstallationsApi).mockResolvedValue([
      makePdkInstallation(installedPdk),
    ])
    vi.mocked(removePdkInstallationApi).mockRejectedValue(new Error('Resource is busy'))

    const store = usePluginStore()
    await store.fetchTools()
    await store.uninstallResource('pdk:ics55')

    expect(removePdkInstallationApi).toHaveBeenCalledWith('pdk:ics55')
    expect(store.resourceErrors['pdk:ics55']).toBe('Resource is busy')
    expect(store.resources.find((resource) => resource.path)).toMatchObject({
      id: 'pdk:ics55',
      status: 'installed',
    })
  })

  it('refreshes resources immediately after uninstall without waiting for SSE progress', async () => {
    const installedPdk = makePdkResource({
      status: 'installed',
      installed_version: '1.01',
      path: '/tmp/pdks/ics55',
      actions: ['uninstall'],
    })

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([makePdkResource()])
      .mockResolvedValueOnce([makePdkResource()])
    vi.mocked(listPdkInstallationsApi)
      .mockResolvedValueOnce([makePdkInstallation(installedPdk)])
      .mockResolvedValueOnce([])
    vi.mocked(removePdkInstallationApi).mockResolvedValue({
      unboundProjectIds: [],
    })

    const store = usePluginStore()
    await store.fetchTools()
    await store.uninstallResource('pdk:ics55')

    expect(removePdkInstallationApi).toHaveBeenCalledWith('pdk:ics55')
    expect(subscribeResourceProgress).not.toHaveBeenCalled()
    expect(listResourcesApi).toHaveBeenCalledTimes(2)
    expect(store.resources).toEqual([makePdkResource()])
  })

  it('imports a local resource path, clears row errors, and refreshes resources', async () => {
    const localTool = makeToolResource({
      status: 'installed',
      source: 'local',
      path: '/tmp/oss-cad-suite',
      actions: ['install', 'remove_reference'],
      health: { managed: false },
    })

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([makeToolResource()])
      .mockResolvedValueOnce([localTool])
    vi.mocked(importLocalResourcePathApi).mockResolvedValue(localTool)

    const store = usePluginStore()
    await store.fetchTools()
    store.resourceErrors['tool:yosys'] = 'Previous error'

    await store.importLocalResource('tool:yosys', '/tmp/oss-cad-suite')

    expect(importLocalResourcePathApi).toHaveBeenCalledWith(
      'tool:yosys',
      '/tmp/oss-cad-suite',
    )
    expect(listResourcesApi).toHaveBeenCalledTimes(2)
    expect(store.resourceErrors['tool:yosys']).toBeUndefined()
    expect(store.resources[0]).toMatchObject({
      id: 'tool:yosys',
      status: 'installed',
      source: 'local',
      path: '/tmp/oss-cad-suite',
    })
  })

  it('uses a caller-provided local importer while preserving row error handling', async () => {
    const localPdk = makePdkResource({
      status: 'installed',
      source: 'local',
      path: '/tmp/pdk',
      actions: ['validate', 'remove_reference'],
      health: { managed: false },
    })
    const importPdkForResource = vi.fn(async () => localPdk)

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([makePdkResource()])
      .mockResolvedValueOnce([makePdkResource()])
    vi.mocked(listPdkInstallationsApi)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makePdkInstallation(localPdk)])

    const store = usePluginStore()
    await store.fetchTools()
    store.resourceErrors['pdk:ics55'] = 'Previous error'

    await store.importLocalResource('pdk:ics55', '/tmp/pdk', importPdkForResource)

    expect(importPdkForResource).toHaveBeenCalledWith('pdk:ics55', '/tmp/pdk')
    expect(importLocalResourcePathApi).not.toHaveBeenCalled()
    expect(store.resourceErrors['pdk:ics55']).toBeUndefined()
    expect(listResourcesApi).toHaveBeenCalledTimes(2)
    expect(store.resources.find((resource) => resource.path)).toMatchObject({
      id: 'pdk:ics55',
      status: 'installed',
      source: 'imported',
      path: '/tmp/pdk',
    })
  })

  it('stores local import errors by resourceId and refreshes resources silently', async () => {
    const availableTool = makeToolResource()
    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([availableTool])
      .mockResolvedValueOnce([availableTool])
    vi.mocked(importLocalResourcePathApi).mockRejectedValue(
      new Error('Expected executable not found for yosys'),
    )

    const store = usePluginStore()
    await store.fetchTools()

    await store.importLocalResource('tool:yosys', '/tmp/oss-cad-suite')

    expect(store.resourceErrors['tool:yosys']).toBe(
      'Expected executable not found for yosys',
    )
    expect(listResourcesApi).toHaveBeenCalledTimes(2)
  })
})
