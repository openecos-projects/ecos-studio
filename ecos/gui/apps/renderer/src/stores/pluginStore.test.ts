import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/api/plugin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/plugin')>()

  return {
    ...actual,
    activatePdkApi: vi.fn(),
    cancelResourceApi: vi.fn(),
    installResourceApi: vi.fn(),
    installToolApi: vi.fn(),
    listResourcesApi: vi.fn(),
    refreshRegistryApi: vi.fn(),
    removePdkReferenceApi: vi.fn(),
    resourceListToTools: vi.fn(actual.resourceListToTools),
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
  installResourceApi,
  listResourcesApi,
  resourceListToTools,
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
    vi.mocked(installResourceApi).mockReset()
    vi.mocked(listResourcesApi).mockReset()
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
      makePdkResource({
        status: 'installed',
        actions: ['validate', 'activate'],
        path: '/tmp/pdks/ics55',
      }),
    ]
    vi.mocked(listResourcesApi).mockResolvedValue(unifiedResources)

    const store = usePluginStore()
    await store.fetchTools()

    expect(listResourcesApi).toHaveBeenCalledTimes(1)
    expect(resourceListToTools).toHaveBeenCalledWith({
      resources: unifiedResources,
      diagnostics: [],
    })
    expect(store.resources.map((resource) => resource.id)).toEqual(['tool:yosys', 'pdk:ics55'])
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

  it('installs a PDK resource and subscribes by resourceId', async () => {
    const availablePdk = makePdkResource()
    const installedPdk = makePdkResource({
      status: 'installed',
      installed_version: '1.01',
      path: '/tmp/pdks/ics55',
      actions: ['validate', 'activate'],
    })
    let onProgress: ((progress: InstallProgress) => void) | undefined
    const close = vi.fn()

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([availablePdk])
      .mockResolvedValueOnce([installedPdk])
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
    expect(store.resources[0]).toMatchObject({
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
      actions: ['validate', 'activate'],
    })
    let onProgress: ((progress: InstallProgress) => void) | undefined
    const close = vi.fn()

    vi.mocked(listResourcesApi)
      .mockResolvedValueOnce([availablePdk])
      .mockResolvedValueOnce([installedPdk])
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

    expect(subscribeResourceProgress).toHaveBeenCalledBefore(vi.mocked(installResourceApi))
    expect(close).toHaveBeenCalledTimes(1)
    expect(store.resources[0]).toMatchObject({
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
    vi.mocked(installResourceApi).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectInstall = reject
    }))
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
    vi.mocked(installResourceApi).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectInstall = reject
    }))
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
    vi.mocked(updateResourceApi).mockImplementation(() => new Promise((_resolve, reject) => {
      rejectUpdate = reject
    }))
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
      .mockResolvedValueOnce([installedPdk])
      .mockResolvedValueOnce([installedPdk])
    vi.mocked(uninstallResourceApi).mockRejectedValue(new Error('Resource is busy'))

    const store = usePluginStore()
    await store.fetchTools()
    await store.uninstallResource('pdk:ics55')

    expect(uninstallResourceApi).toHaveBeenCalledWith('pdk:ics55')
    expect(store.resourceErrors['pdk:ics55']).toBe('Resource is busy')
    expect(store.resources[0]).toMatchObject({
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
      .mockResolvedValueOnce([installedPdk])
      .mockResolvedValueOnce([])
    vi.mocked(uninstallResourceApi).mockResolvedValue({
      status: 'uninstalled',
      resource_id: 'pdk:ics55',
    })

    const store = usePluginStore()
    await store.fetchTools()
    await store.uninstallResource('pdk:ics55')

    expect(uninstallResourceApi).toHaveBeenCalledWith('pdk:ics55')
    expect(subscribeResourceProgress).not.toHaveBeenCalled()
    expect(listResourcesApi).toHaveBeenCalledTimes(2)
    expect(store.resources).toEqual([])
  })
})
