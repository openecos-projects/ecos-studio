import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PdkInventoryService } from './pdkInventoryService'

const tempDirectories: string[] = []

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ecos-pdk-inventory-'))
  tempDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('PdkInventoryService', () => {
  it('represents a real directory and its symlink as one stable Installation', async () => {
    const root = await createTempDir()
    const pdkRoot = join(root, 'local', 'ics55')
    const pdkLink = join(root, 'local', 'ics55-link')
    await mkdir(pdkRoot, { recursive: true })
    await symlink(pdkRoot, pdkLink)
    const service = new PdkInventoryService({
      inventoryPath: join(root, 'state', 'pdk-inventory.json'),
      managedRoot: join(root, 'managed-pdks'),
    })

    const imported = await service.importInstallation({
      displayName: 'ICS55',
      familyId: 'ics55',
      root: pdkLink,
    })
    const duplicate = await service.importInstallation({
      displayName: 'ICS55',
      familyId: 'ics55',
      root: pdkRoot,
    })

    expect(duplicate.id).toBe(imported.id)
    await expect(service.listInstallations()).resolves.toEqual([
      expect.objectContaining({
        id: imported.id,
        readiness: 'invalid',
        root: pdkRoot,
      }),
    ])
  })

  it('binds one matching Unverified Installation before the Project directory exists', async () => {
    const root = await createTempDir()
    const pdkRoot = join(root, 'vendor-pdk')
    const projectRoot = join(root, 'project')
    const inventoryPath = join(root, 'state', 'pdk-inventory.json')
    await mkdir(pdkRoot, { recursive: true })
    const service = new PdkInventoryService({
      inventoryPath,
      managedRoot: join(root, 'managed-pdks'),
    })
    const installation = await service.importInstallation({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      root: pdkRoot,
    })

    await expect(
      service.resolveBinding({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          manualConfig: null,
          version: null,
        },
      }),
    ).resolves.toMatchObject({ installationId: installation.id })
    await expect(
      new PdkInventoryService({
        inventoryPath,
        managedRoot: join(root, 'managed-pdks'),
      }).resolveBinding({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          manualConfig: null,
          version: null,
        },
      }),
    ).resolves.toMatchObject({ installationId: installation.id })
    await expect(
      service.bindInstallation({
        installationId: installation.id,
        familyId: 'other-pdk',
        projectId: 'proj_other',
        projectRoot: join(root, 'other-project'),
      }),
    ).rejects.toThrow('does not satisfy the Project Requirement')
  })

  it('rejects Manual PDK Configuration paths outside the bound Installation', async () => {
    const root = await createTempDir()
    const pdkRoot = join(root, 'vendor-pdk')
    const projectRoot = join(root, 'project')
    await mkdir(pdkRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    await writeFile(join(pdkRoot, 'tech.lef'), 'VERSION 5.8 ;\n')
    await writeFile(join(pdkRoot, 'cells.lef'), 'VERSION 5.8 ;\n')
    await writeFile(join(root, 'outside.lib'), 'library(test) {}\n')
    const service = new PdkInventoryService({
      inventoryPath: join(root, 'state', 'pdk-inventory.json'),
      managedRoot: join(root, 'managed-pdks'),
    })
    await service.importInstallation({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      root: pdkRoot,
    })
    await service.resolveBinding({
      projectId: 'proj_demo',
      projectRoot,
      requirement: {
        familyId: 'vendor-pdk',
        manualConfig: null,
        version: null,
      },
    })

    await expect(
      service.validateWorkspace({
        projectId: 'proj_demo',
        projectRoot,
        manualConfig: {
          techLef: 'tech.lef',
          cellLefs: ['cells.lef'],
          liberty: ['../outside.lib'],
        },
      }),
    ).rejects.toThrow('outside the PDK root')
  })

  it('locates a Missing Installation without changing its identity or Binding', async () => {
    const root = await createTempDir()
    const oldRoot = join(root, 'old-pdk')
    const newRoot = join(root, 'new-pdk')
    const projectRoot = join(root, 'project')
    await mkdir(oldRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    const service = new PdkInventoryService({
      inventoryPath: join(root, 'state', 'pdk-inventory.json'),
      managedRoot: join(root, 'managed-pdks'),
    })
    const installation = await service.importInstallation({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      root: oldRoot,
    })
    await service.resolveBinding({
      projectId: 'proj_demo',
      projectRoot,
      requirement: {
        familyId: 'vendor-pdk',
        manualConfig: null,
        version: null,
      },
    })
    await rm(oldRoot, { recursive: true })
    await mkdir(newRoot)

    await expect(
      service.locateInstallation({ installationId: installation.id, root: newRoot }),
    ).resolves.toMatchObject({
      id: installation.id,
      readiness: 'unverified',
      root: newRoot,
    })
    await expect(
      service.resolveBinding({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          manualConfig: null,
          version: null,
        },
      }),
    ).resolves.toMatchObject({ installationId: installation.id })
  })

  it('removes an Imported Installation and its Bindings without deleting content', async () => {
    const root = await createTempDir()
    const pdkRoot = join(root, 'vendor-pdk')
    const projectRoot = join(root, 'project')
    await mkdir(pdkRoot, { recursive: true })
    await mkdir(projectRoot, { recursive: true })
    const service = new PdkInventoryService({
      inventoryPath: join(root, 'state', 'pdk-inventory.json'),
      managedRoot: join(root, 'managed-pdks'),
    })
    const installation = await service.importInstallation({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      root: pdkRoot,
    })
    await service.resolveBinding({
      projectId: 'proj_demo',
      projectRoot,
      requirement: {
        familyId: 'vendor-pdk',
        manualConfig: null,
        version: null,
      },
    })

    await expect(service.removeInstallation(installation.id)).resolves.toEqual({
      unboundProjectIds: ['proj_demo'],
    })
    await expect(stat(pdkRoot)).resolves.toMatchObject({})
    await expect(service.listInstallations()).resolves.toEqual([])
    await expect(
      service.resolveBinding({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          manualConfig: null,
          version: null,
        },
      }),
    ).resolves.toBeNull()
  })

  it('migrates and deduplicates legacy PDK records once', async () => {
    const root = await createTempDir()
    const pdkRoot = join(root, 'vendor-pdk')
    const pdkLink = join(root, 'vendor-pdk-link')
    const projectRoot = join(root, 'demo-project')
    const legacyManifestPath = join(root, 'state', 'manifest.json')
    const inventoryPath = join(root, 'state', 'pdk-inventory.json')
    await mkdir(pdkRoot)
    await mkdir(projectRoot)
    await symlink(pdkRoot, pdkLink)
    await mkdir(join(root, 'state'))
    const entry = {
      type: 'pdk',
      id: 'vendor-pdk',
      name: 'Vendor PDK',
      pdk_id: 'vendor-pdk',
      version: '',
      path: pdkLink,
      canonical_path: pdkLink,
      managed: false,
    }
    await writeFile(
      legacyManifestPath,
      JSON.stringify({
        schema_version: 3,
        installed: {
          'pdk:vendor-pdk:local:first': entry,
          'pdk:vendor-pdk:local:duplicate': { ...entry, path: pdkRoot },
          'tool:yosys': { type: 'tool', name: 'yosys' },
        },
        pdk_references: [
          {
            project_path: projectRoot,
            pdk_root: pdkLink,
            resource_id: 'pdk:vendor-pdk:local:duplicate',
          },
        ],
      }),
    )
    const service = new PdkInventoryService({
      inventoryPath,
      legacyManifestPath,
      managedRoot: join(root, 'managed-pdks'),
    })

    const first = await service.listInstallations()
    const second = await new PdkInventoryService({
      inventoryPath,
      legacyManifestPath,
      managedRoot: join(root, 'managed-pdks'),
    }).listInstallations()

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    const migrated = JSON.parse(await readFile(inventoryPath, 'utf8')) as {
      bindings: Array<{ installationId: string }>
      installations: Array<{ id: string; root: string }>
    }
    expect(migrated.installations[0]).toEqual({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      id: 'pdk:vendor-pdk:local:first',
      ownership: 'imported',
      root: pdkRoot,
      version: null,
    })
    expect(migrated.bindings[0]?.installationId).toBe('pdk:vendor-pdk:local:first')
    const legacy = JSON.parse(await readFile(legacyManifestPath, 'utf8')) as {
      installed: Record<string, unknown>
      pdk_references: unknown[]
    }
    expect(Object.keys(legacy.installed)).toEqual(['tool:yosys'])
    expect(legacy.pdk_references).toEqual([])
  })

  it('uninstalls Managed content only from the managed root', async () => {
    const root = await createTempDir()
    const managedRoot = join(root, 'managed-pdks')
    const pdkRoot = join(managedRoot, 'ics55', '1.10.100')
    await mkdir(pdkRoot, { recursive: true })
    const service = new PdkInventoryService({
      inventoryPath: join(root, 'state', 'pdk-inventory.json'),
      managedRoot,
    })
    const installation = await service.registerManagedInstallation({
      id: 'pdk:ics55:managed:1.10.100',
      displayName: 'ICS55',
      familyId: 'ics55',
      root: pdkRoot,
      version: '1.10.100',
    })

    await service.removeInstallation(installation.id)

    await expect(stat(pdkRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(service.listInstallations()).resolves.toEqual([])
  })
})
