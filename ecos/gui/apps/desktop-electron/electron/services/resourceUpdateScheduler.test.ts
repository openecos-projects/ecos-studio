import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ResourceInfo,
  ResourceList,
  ResourceUpdateCheckResult,
} from '@ecos-studio/shared'

const electronLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  status: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('./logger', () => ({
  electronLogger,
}))

import { ResourceUpdateScheduler } from './resourceUpdateScheduler'

function makeResource(overrides: Partial<ResourceInfo> = {}): ResourceInfo {
  return {
    id: 'tool:yosys',
    type: 'tool',
    name: 'yosys',
    display_name: 'Yosys',
    description: 'RTL synthesis',
    category: 'synthesis',
    status: 'update_available',
    installed_version: '0.61',
    available_versions: ['0.62'],
    active_version: null,
    active: false,
    path: '/tmp/tools/yosys/0.61',
    managed_root: null,
    platform: 'linux-x86_64',
    size: null,
    source: 'registry',
    homepage: '',
    actions: ['update'],
    health: {},
    error: null,
    ...overrides,
  }
}

function makeResourceList(resources: ResourceInfo[]): ResourceList {
  return { resources, diagnostics: [] }
}

function makeCheckResult(): ResourceUpdateCheckResult {
  return {
    status: 'checked',
    checked_count: 0,
    update_count: 0,
    diagnostics: [],
    resources: [],
  }
}

function createServiceStub() {
  return {
    isUpdateCheckCacheStale: vi.fn(async (_now?: number) => false),
    checkResourceUpdates: vi.fn(
      async (_options?: { force?: boolean; refreshRegistry?: boolean }) =>
        makeCheckResult(),
    ),
    listResources: vi.fn(async () => makeResourceList([])),
  }
}

afterEach(() => {
  vi.useRealTimers()
  electronLogger.warn.mockReset()
})

describe('ResourceUpdateScheduler', () => {
  it('skips checkResourceUpdates when the cache is fresh but still emits from the listing', async () => {
    const service = createServiceStub()
    service.listResources.mockResolvedValue(makeResourceList([makeResource()]))
    const emit = vi.fn()
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
    })

    await scheduler.runCycle('focus')

    expect(service.checkResourceUpdates).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith({
      resources: [
        {
          resource_id: 'tool:yosys',
          display_name: 'Yosys',
          update_kind: null,
          installed_version: '0.61',
          latest_version: '0.62',
        },
      ],
    })
  })

  it('runs a non-forced check before listing when the cache is stale', async () => {
    const service = createServiceStub()
    service.isUpdateCheckCacheStale.mockResolvedValue(true)
    service.listResources.mockResolvedValue(makeResourceList([makeResource()]))
    const emit = vi.fn()
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
    })

    await scheduler.runCycle('startup')

    expect(service.checkResourceUpdates).toHaveBeenCalledWith({ force: false })
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('single-flights concurrent cycles', async () => {
    const service = createServiceStub()
    let releaseListing!: (list: ResourceList) => void
    service.listResources.mockImplementation(
      () =>
        new Promise<ResourceList>((resolve) => {
          releaseListing = resolve
        }),
    )
    const emit = vi.fn()
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
    })

    const first = scheduler.runCycle('focus')
    const second = scheduler.runCycle('interval')
    await vi.waitFor(() => {
      expect(service.listResources).toHaveBeenCalledTimes(1)
    })
    releaseListing(makeResourceList([makeResource()]))
    await Promise.all([first, second])

    expect(service.listResources).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('emits only newly appeared updates across cycles', async () => {
    const service = createServiceStub()
    service.listResources.mockResolvedValue(makeResourceList([makeResource()]))
    const emit = vi.fn()
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
    })

    await scheduler.runCycle('focus')
    await scheduler.runCycle('focus')
    expect(emit).toHaveBeenCalledTimes(1)

    service.listResources.mockResolvedValue(
      makeResourceList([
        makeResource(),
        makeResource({
          id: 'pdk:ics55',
          type: 'pdk',
          name: 'ics55',
          display_name: 'ICS55 PDK',
          update_kind: 'rebuild',
          installed_version: '1.0',
          available_versions: ['1.0'],
        }),
      ]),
    )
    await scheduler.runCycle('focus')

    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenLastCalledWith({
      resources: [
        {
          resource_id: 'pdk:ics55',
          display_name: 'ICS55 PDK',
          update_kind: 'rebuild',
          installed_version: '1.0',
          latest_version: '1.0',
        },
      ],
    })
  })

  it('re-notifies an update after it disappeared and returned', async () => {
    const service = createServiceStub()
    service.listResources.mockResolvedValue(makeResourceList([makeResource()]))
    const emit = vi.fn()
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
    })

    await scheduler.runCycle('focus')
    service.listResources.mockResolvedValue(makeResourceList([]))
    await scheduler.runCycle('focus')
    service.listResources.mockResolvedValue(makeResourceList([makeResource()]))
    await scheduler.runCycle('focus')

    expect(emit).toHaveBeenCalledTimes(2)
  })

  it('start() runs a startup cycle and fires interval cycles until stop()', async () => {
    vi.useFakeTimers()
    const service = createServiceStub()
    service.listResources.mockResolvedValue(makeResourceList([makeResource()]))
    const emit = vi.fn()
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
      intervalMs: 60_000,
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.listResources).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(service.listResources).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(service.listResources).toHaveBeenCalledTimes(3)

    scheduler.stop()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(service.listResources).toHaveBeenCalledTimes(3)
  })

  it('logs and resolves when emit throws', async () => {
    const service = createServiceStub()
    service.listResources.mockResolvedValue(makeResourceList([makeResource()]))
    const emit = vi.fn(() => {
      throw new Error('no windows')
    })
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
    })

    await expect(scheduler.runCycle('interval')).resolves.toBeUndefined()
    expect(electronLogger.warn).toHaveBeenCalledTimes(1)
  })

  it('logs and resolves when the service fails', async () => {
    const service = createServiceStub()
    service.isUpdateCheckCacheStale.mockRejectedValue(new Error('cache read blew up'))
    const emit = vi.fn()
    const scheduler = new ResourceUpdateScheduler({
      resourceManagerService: service,
      emit,
    })

    await expect(scheduler.runCycle('startup')).resolves.toBeUndefined()
    expect(emit).not.toHaveBeenCalled()
    expect(electronLogger.warn).toHaveBeenCalledTimes(1)
  })
})
