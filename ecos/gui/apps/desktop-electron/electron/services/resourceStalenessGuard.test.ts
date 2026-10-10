import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  PdkBinding,
  PdkInstallationSnapshot,
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

function makeInstallation(
  overrides: Partial<PdkInstallationSnapshot> = {},
): PdkInstallationSnapshot {
  return {
    id: 'pdk-install-1',
    familyId: 'ics55',
    displayName: 'ICS55 PDK',
    version: '1.0.0',
    root: '/pdks/ics55',
    ownership: 'managed',
    registrySha256: 'a'.repeat(64),
    readiness: 'ready',
    reason: null,
    supportsEccDefaults: true,
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
      listResources: vi.fn(
        async (): Promise<ResourceList> => ({
          resources: [],
          diagnostics: [],
        }),
      ),
      readCachedLatestPdkRelease: vi.fn(
        async (): Promise<{ version: string; sha256: string | null } | null> => null,
      ),
    },
    pdkInventoryService: {
      listBindings: vi.fn(async (): Promise<PdkBinding[]> => []),
      listInstallations: vi.fn(async (): Promise<PdkInstallationSnapshot[]> => []),
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
    stubs.resourceManagerService.listResources.mockResolvedValue({
      resources: [makeResource({ active: true, update_kind: 'version' })],
      diagnostics: [],
    })

    const items = await assessRunStaleness(assessOptions(stubs))

    expect(items).toEqual([STALE_ITEM])
  })

  it('excludes an inactive tool with an available update', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listResources.mockResolvedValue({
      resources: [makeResource({ active: false })],
      diagnostics: [],
    })

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
  })

  it('includes a bound MPC with an available update', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listResources.mockResolvedValue({
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
    stubs.resourceManagerService.listResources.mockResolvedValue({
      resources: [makeResource({ active: true, status: 'installed' })],
      diagnostics: [],
    })

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
  })

  it('logs the active run inputs with a short update-check ref', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listResources.mockResolvedValue({
      resources: [
        makeResource({
          active: true,
          status: 'installed',
          active_version: '0.61',
          health: {
            update_check: { commit: 'abcdef1234567890' },
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
    stubs.resourceManagerService.listResources.mockRejectedValue(
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
  it('reports a version drift against the cached registry release', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([makeInstallation()])
    stubs.resourceManagerService.readCachedLatestPdkRelease.mockResolvedValue({
      version: '1.1.0',
      sha256: 'b'.repeat(64),
    })

    const items = await assessRunStaleness(assessOptions(stubs))

    expect(items).toEqual([
      {
        id: 'pdk-install-1',
        display_name: 'ICS55 PDK',
        installed_version: '1.0.0',
        latest_version: '1.1.0',
        update_kind: 'version',
      },
    ])
  })

  it('reports a rebuild when the version matches but the asset sha drifted', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([makeInstallation()])
    stubs.resourceManagerService.readCachedLatestPdkRelease.mockResolvedValue({
      version: '1.0.0',
      sha256: 'b'.repeat(64),
    })

    const items = await assessRunStaleness(assessOptions(stubs))

    expect(items).toEqual([
      expect.objectContaining({ id: 'pdk-install-1', update_kind: 'rebuild' }),
    ])
  })

  it('skips a fresh installation', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([makeInstallation()])
    stubs.resourceManagerService.readCachedLatestPdkRelease.mockResolvedValue({
      version: '1.0.0',
      sha256: 'a'.repeat(64),
    })

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
  })

  it('skips an imported installation even when the registry has a newer release', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([
      makeInstallation({
        ownership: 'imported',
        version: null,
        registrySha256: null,
      }),
    ])

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
    expect(stubs.resourceManagerService.readCachedLatestPdkRelease).not.toHaveBeenCalled()
  })

  it('skips a managed installation without a recorded version', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([
      makeInstallation({ version: null }),
    ])

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
    expect(stubs.resourceManagerService.readCachedLatestPdkRelease).not.toHaveBeenCalled()
  })

  it('skips bindings whose project root does not contain the workspace', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([
      makeBinding({ projectRoot: '/work/other' }),
    ])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([makeInstallation()])
    stubs.resourceManagerService.readCachedLatestPdkRelease.mockResolvedValue({
      version: '1.1.0',
      sha256: null,
    })

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
    expect(stubs.resourceManagerService.readCachedLatestPdkRelease).not.toHaveBeenCalled()
  })

  it('does not match a sibling directory sharing a path prefix', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([
      makeBinding({ projectRoot: '/work/demo' }),
    ])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([makeInstallation()])

    await expect(
      assessRunStaleness(assessOptions(stubs, '/work/demo-other/ws_1')),
    ).resolves.toEqual([])
  })

  it('prefers the longest matching project root', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([
      makeBinding({ projectRoot: '/work', installationId: 'pdk-outer' }),
      makeBinding({ projectRoot: '/work/demo', installationId: 'pdk-inner' }),
    ])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([
      makeInstallation({ id: 'pdk-outer', version: '1.0.0' }),
      makeInstallation({ id: 'pdk-inner', version: '1.0.0' }),
    ])
    stubs.resourceManagerService.readCachedLatestPdkRelease.mockResolvedValue({
      version: '2.0.0',
      sha256: null,
    })

    const items = await assessRunStaleness(assessOptions(stubs))

    expect(items).toEqual([expect.objectContaining({ id: 'pdk-inner' })])
  })

  it('skips the PDK assessment without a workspace directory', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listResources.mockResolvedValue({
      resources: [makeResource({ active: true })],
      diagnostics: [],
    })

    const items = await assessRunStaleness(assessOptions(stubs, null))

    expect(items).toEqual([STALE_ITEM])
    expect(stubs.pdkInventoryService.listBindings).not.toHaveBeenCalled()
  })

  it('skips the PDK when the bound installation is unknown', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([])

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
  })

  it('skips the PDK when no cached registry release is available', async () => {
    const stubs = createServiceStubs()
    stubs.pdkInventoryService.listBindings.mockResolvedValue([makeBinding()])
    stubs.pdkInventoryService.listInstallations.mockResolvedValue([makeInstallation()])
    stubs.resourceManagerService.readCachedLatestPdkRelease.mockResolvedValue(null)

    await expect(assessRunStaleness(assessOptions(stubs))).resolves.toEqual([])
  })

  it('keeps tool items when the PDK assessment fails', async () => {
    const stubs = createServiceStubs()
    stubs.resourceManagerService.listResources.mockResolvedValue({
      resources: [makeResource({ active: true })],
      diagnostics: [],
    })
    stubs.pdkInventoryService.listBindings.mockRejectedValue(
      new Error('inventory locked'),
    )

    const items = await assessRunStaleness(assessOptions(stubs))

    expect(items).toEqual([STALE_ITEM])
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
