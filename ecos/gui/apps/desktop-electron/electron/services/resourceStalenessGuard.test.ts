import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PdkBinding,
  ResourceInfo,
  ResourceList,
  ResourceStalenessItem,
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

import { assessRunStaleness, assertRunResourcesFresh } from './resourceStalenessGuard'

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
    update_kind: 'version',
    ...overrides,
  }
}

function makeBinding(overrides: Partial<PdkBinding> = {}): PdkBinding {
  return {
    projectId: 'project-1',
    projectRoot: '/work/demo',
    installationId: 'pdk-install-1',
    ...overrides,
  }
}

function createServiceStubs() {
  return {
    resourceManagerService: {
      listCachedResources: vi.fn(
        async (): Promise<ResourceList> => ({
          resources: [],
          diagnostics: [],
        }),
      ),
    },
    pdkInventoryService: {
      listBindings: vi.fn(async (): Promise<PdkBinding[]> => []),
    },
  }
}

function assessOptions(
  stubs: ReturnType<typeof createServiceStubs>,
  workspaceDirectory: string | null = '/work/demo/ws_1',
) {
  return {
    resourceManagerService: stubs.resourceManagerService,
    pdkInventoryService: stubs.pdkInventoryService,
    workspaceDirectory,
  }
}

const STALE_ITEM: ResourceStalenessItem = {
  id: 'tool:yosys',
  display_name: 'Yosys',
  installed_version: '0.61',
  latest_version: '0.62',
  update_kind: 'version',
}

beforeEach(() => {
  electronLogger.info.mockReset()
  electronLogger.warn.mockReset()
})

describe('assessRunStaleness tools and MPCs', () => {
  it('includes an active tool with an available update', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listCachedResources.mockResolvedValue({
      resources: [makeResource({ active: true, update_kind: 'version' })],
      diagnostics: [],
    })

    const items = await assessRunStaleness(assessOptions(stubs))

    expect(items).toEqual([STALE_ITEM])
  })

  it('excludes an inactive tool with an available update', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listCachedResources.mockResolvedValue({
      resources: [makeResource({ active: false })],
      diagnostics: [],
    })

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
  })

  it('includes a bound MPC with an available update', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listCachedResources.mockResolvedValue({
      resources: [
        makeResource({
          id: 'mpc:gf180',
          type: 'mpc',
          name: 'gf180',
          display_name: 'GF180 MPC',
        }),
      ],
      diagnostics: [],
    })

    const items = await assessRunStaleness(assessOptions(stubs))

    expect(items).toEqual([{ ...STALE_ITEM, id: 'mpc:gf180', display_name: 'GF180 MPC' }])
  })

  it('excludes resources without update_available status', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listCachedResources.mockResolvedValue({
      resources: [makeResource({ active: true, status: 'installed' })],
      diagnostics: [],
    })

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
  })

  it('logs the installed ref rather than the published update ref', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listCachedResources.mockResolvedValue({
      resources: [
        makeResource({
          active: true,
          status: 'installed',
          active_version: '0.61',
          health: {
            sha256: 'abcdef1234567890',
            update_check: { commit: 'fedcba9876543210' },
          },
        }),
      ],
      diagnostics: [],
    })

    await assessRunStaleness(assessOptions(stubs))

    expect(electronLogger.info).toHaveBeenCalledWith(
      '[resources] run inputs: %s',
      'yosys@0.61 (abcdef12)',
    )
  })

  it('keeps returning tool items when the listing fails', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listCachedResources.mockRejectedValue(
      new Error('cache unreadable'),
    )

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
    expect(electronLogger.warn).toHaveBeenCalledWith(
      '[resources] run staleness assessment failed to list',
      expect.any(Error),
    )
  })
})

describe('assessRunStaleness bound PDK', () => {
  function stalePdk(id = 'pdk-install-1'): ResourceInfo {
    return makeResource({
      id,
      type: 'pdk',
      display_name: 'ICS55 PDK',
      installed_version: '1.0.0',
      available_versions: ['1.1.0'],
    })
  }

  it.each(['version', 'rebuild'] as const)(
    'includes the bound PDK %s update from the cached listing',
    async (update_kind) => {
      const stubs = createServiceStubs()
      stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
      stubs.resourceManagerService.listCachedResources.mockResolvedValue({
        resources: [stalePdk(), makeResource({ id: 'pdk-other', type: 'pdk' })].map(
          (resource) => ({ ...resource, update_kind }),
        ),
        diagnostics: [],
      })
      await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([
        {
          id: 'pdk-install-1',
          display_name: 'ICS55 PDK',
          installed_version: '1.0.0',
          latest_version: '1.1.0',
          update_kind,
        },
      ])
    },
  )

  it.each(['installed', 'missing', 'invalid', 'available'] as const)(
    'skips a bound PDK with %s status',
    async (status) => {
      const stubs = createServiceStubs()
      stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
      stubs.resourceManagerService.listCachedResources.mockResolvedValue({
        resources: [{ ...stalePdk(), status }],
        diagnostics: [],
      })
      await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
    },
  )

  it.each(['/work/other', '/work/demo-other'])(
    'does not match unrelated workspace %s',
    async (workspaceDirectory) => {
      const stubs = createServiceStubs()
      stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
      stubs.resourceManagerService.listCachedResources.mockResolvedValue({
        resources: [stalePdk()],
        diagnostics: [],
      })
      await expect(
        assessRunStaleness(assessOptions(stubs, workspaceDirectory)),
      ).resolves.toEqual([])
    },
  )

  it('prefers the longest matching project root', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([
      makeBinding({ projectRoot: '/work', installationId: 'pdk-outer' }),
      makeBinding({ projectRoot: '/work/demo', installationId: 'pdk-inner' }),
    ])
    stubs.resourceManagerService.listCachedResources.mockResolvedValue({
      resources: [stalePdk('pdk-outer'), stalePdk('pdk-inner')],
      diagnostics: [],
    })
    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([
      expect.objectContaining({ id: 'pdk-inner' }),
    ])
  })

  it('skips missing installation data and missing workspace directories', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
    stubs.pdkInventoryService.listBindings.mockClear()
    await expect(assessRunStaleness(assessOptions(stubs, null))).resolves.toEqual([])
    expect(stubs.pdkInventoryService.listBindings).not.toHaveBeenCalled()
  })

  it('keeps tool items when the PDK binding assessment fails', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listCachedResources.mockResolvedValue({
      resources: [makeResource({ active: true })],
      diagnostics: [],
    })
    stubs.pdkInventoryService.listBindings.mockRejectedValue(
      new Error('inventory locked'),
    )
    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([STALE_ITEM])
    expect(electronLogger.warn).toHaveBeenCalledWith(
      '[resources] run staleness PDK assessment failed',
      expect.any(Error),
    )
  })
})

describe('assertRunResourcesFresh', () => {
  it('does nothing for an empty assessment', () => {
    expect(() => assertRunResourcesFresh([], undefined, 'workspace.run')).not.toThrow()
  })

  it('throws the coded error with the items in details', () => {
    let thrown: unknown
    try {
      assertRunResourcesFresh([STALE_ITEM], undefined, 'workspace.run')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      code: 'RESOURCE_UPDATE_AVAILABLE',
      details: { resources: [STALE_ITEM] },
    })
    expect((thrown as Error).message).toContain(
      'Resource updates are available for: Yosys',
    )
    expect((thrown as Error).message).toContain('allowStaleResources')
  })

  it('warn-logs and proceeds when stale resources are explicitly allowed', () => {
    expect(() =>
      assertRunResourcesFresh([STALE_ITEM], true, 'workspace.run'),
    ).not.toThrow()
    expect(electronLogger.warn).toHaveBeenCalledWith(
      '[resources] %s proceeds with stale resources: %s',
      'workspace.run',
      'Yosys',
    )
  })
})
