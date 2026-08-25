import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PdkInventoryService } from './pdkInventoryService'
import { writeJsonAtomic } from './pdkInventoryMigration'

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
        requirement: {
          familyId: 'other-pdk',
          version: null,
          manualConfig: null,
        },
        projectId: 'proj_other',
        projectRoot: join(root, 'other-project'),
      }),
    ).rejects.toThrow('does not satisfy the Project Requirement')
    await expect(
      service.bindInstallation({
        installationId: installation.id,
        requirement: {
          familyId: 'vendor-pdk',
          version: '2.0',
          manualConfig: null,
        },
        projectId: 'proj_wrong_version',
        projectRoot: join(root, 'wrong-version-project'),
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
    await writeFile(join(pdkRoot, 'typ.lib'), 'library(test) {}\n')
    await writeFile(join(root, 'outside.lib'), 'library(test) {}\n')
    await symlink(join(root, 'outside.lib'), join(pdkRoot, 'escaped.lib'))
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
        requirement: {
          familyId: 'vendor-pdk',
          version: null,
          manualConfig: {
            techLef: 'tech.lef',
            cellLefs: ['cells.lef'],
            liberty: ['../outside.lib'],
          },
        },
      }),
    ).rejects.toThrow('outside the PDK root')
    await expect(
      service.validateWorkspace({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          version: null,
          manualConfig: {
            techLef: 'tech.lef',
            cellLefs: ['cells.lef'],
            liberty: ['typ.lib'],
          },
        },
      }),
    ).resolves.toMatchObject({ readiness: 'unverified' })
    await expect(
      service.validateWorkspace({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          version: null,
          manualConfig: {
            techLef: join(pdkRoot, 'tech.lef'),
            cellLefs: ['cells.lef'],
            liberty: ['typ.lib'],
          },
        },
      }),
    ).rejects.toThrow('must be relative')
    await expect(
      service.validateWorkspace({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          version: null,
          manualConfig: {
            techLef: 'tech.lef',
            cellLefs: ['.'],
            liberty: ['typ.lib'],
          },
        },
      }),
    ).rejects.toThrow('is not a file')
    await expect(
      service.validateWorkspace({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          version: null,
          manualConfig: {
            techLef: 'tech.lef',
            cellLefs: ['cells.lef'],
            liberty: ['missing.lib'],
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      service.validateWorkspace({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          version: null,
          manualConfig: {
            techLef: 'tech.lef',
            cellLefs: ['cells.lef'],
            liberty: ['escaped.lib'],
          },
        },
      }),
    ).rejects.toThrow('outside the PDK root')
    await expect(
      service.validateWorkspace({
        projectId: 'proj_demo',
        projectRoot,
        requirement: {
          familyId: 'vendor-pdk',
          version: null,
          manualConfig: { techLef: 'tech.lef', cellLefs: [], liberty: [] },
        },
      }),
    ).rejects.toThrow('incomplete')
  })

  it('preserves an existing Missing Binding and leaves multiple matches Unbound', async () => {
    const root = await createTempDir()
    const firstRoot = join(root, 'vendor-first')
    const secondRoot = join(root, 'vendor-second')
    const thirdRoot = join(root, 'vendor-third')
    await Promise.all(
      [firstRoot, secondRoot, thirdRoot].map((path) => mkdir(path, { recursive: true })),
    )
    const service = new PdkInventoryService({
      inventoryPath: join(root, 'state', 'pdk-inventory.json'),
      managedRoot: join(root, 'managed-pdks'),
    })
    const first = await service.importInstallation({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      root: firstRoot,
    })
    await service.resolveBinding({
      projectId: 'proj_existing',
      projectRoot: join(root, 'existing-project'),
      requirement: { familyId: 'vendor-pdk', version: null, manualConfig: null },
    })
    await rm(firstRoot, { recursive: true })
    await service.importInstallation({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      root: secondRoot,
    })

    await expect(
      service.resolveBinding({
        projectId: 'proj_existing',
        projectRoot: join(root, 'existing-project'),
        requirement: { familyId: 'vendor-pdk', version: null, manualConfig: null },
      }),
    ).resolves.toMatchObject({ installationId: first.id })

    await service.importInstallation({
      displayName: 'Vendor PDK',
      familyId: 'vendor-pdk',
      root: thirdRoot,
    })
    await expect(
      service.resolveBinding({
        projectId: 'proj_multiple',
        projectRoot: join(root, 'multiple-project'),
        requirement: { familyId: 'vendor-pdk', version: null, manualConfig: null },
      }),
    ).resolves.toBeNull()
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
    await writeFile(
      join(projectRoot, 'project.json'),
      JSON.stringify({ project_id: 'proj_custom_identity' }),
    )
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
      bindings: Array<{ installationId: string; projectId: string }>
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
    expect(migrated.bindings[0]?.projectId).toBe('proj_custom_identity')
    const legacy = JSON.parse(await readFile(legacyManifestPath, 'utf8')) as {
      installed: Record<string, unknown>
      pdk_references: unknown[]
    }
    expect(Object.keys(legacy.installed)).toEqual(['tool:yosys'])
    expect(legacy.pdk_references).toEqual([])
  })

  it('resumes legacy cleanup after Inventory was written', async () => {
    const root = await createTempDir()
    const pdkRoot = join(root, 'vendor-pdk')
    const inventoryPath = join(root, 'state', 'pdk-inventory.json')
    const legacyManifestPath = join(root, 'state', 'manifest.json')
    await mkdir(pdkRoot, { recursive: true })
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(
      legacyManifestPath,
      JSON.stringify({
        schema_version: 3,
        installed: {
          'pdk:vendor-pdk:local:first': {
            type: 'pdk',
            pdk_id: 'vendor-pdk',
            canonical_path: pdkRoot,
            managed: false,
          },
        },
        pdk_references: [],
      }),
    )
    let writes = 0
    const interrupted = new PdkInventoryService({
      inventoryPath,
      legacyManifestPath,
      managedRoot: join(root, 'managed-pdks'),
      jsonWriter: async (path, value) => {
        writes += 1
        if (writes === 2) throw new Error('interrupted legacy cleanup')
        await writeJsonAtomic(path, value)
      },
    })

    await expect(interrupted.listInstallations()).rejects.toThrow(
      'interrupted legacy cleanup',
    )
    await expect(readFile(inventoryPath, 'utf8')).resolves.toContain(
      'pdk:vendor-pdk:local:first',
    )
    await expect(readFile(legacyManifestPath, 'utf8')).resolves.toContain(
      'pdk:vendor-pdk:local:first',
    )

    const resumed = new PdkInventoryService({
      inventoryPath,
      legacyManifestPath,
      managedRoot: join(root, 'managed-pdks'),
    })
    await expect(resumed.listInstallations()).resolves.toHaveLength(1)
    await expect(readFile(legacyManifestPath, 'utf8')).resolves.not.toContain(
      'pdk:vendor-pdk:local:first',
    )
  })

  it('serializes listing with import, Locate, removal, and Binding updates', async () => {
    const root = await createTempDir()
    const movingRoot = join(root, 'moving-old')
    const movedRoot = join(root, 'moving-new')
    const removableRoot = join(root, 'removable')
    const addedRoot = join(root, 'added')
    await Promise.all(
      [movingRoot, movedRoot, removableRoot, addedRoot].map((path) =>
        mkdir(path, { recursive: true }),
      ),
    )
    const service = new PdkInventoryService({
      inventoryPath: join(root, 'state', 'pdk-inventory.json'),
      managedRoot: join(root, 'managed-pdks'),
    })
    const moving = await service.importInstallation({
      displayName: 'Moving PDK',
      familyId: 'moving-pdk',
      root: movingRoot,
    })
    const removable = await service.importInstallation({
      displayName: 'Removable PDK',
      familyId: 'removable-pdk',
      root: removableRoot,
    })
    await service.resolveBinding({
      projectId: 'proj_moving',
      projectRoot: join(root, 'moving-project'),
      requirement: { familyId: 'moving-pdk', version: null, manualConfig: null },
    })

    await Promise.all([
      service.listInstallations(),
      service.importInstallation({
        displayName: 'Added PDK',
        familyId: 'added-pdk',
        root: addedRoot,
      }),
      service.locateInstallation({ installationId: moving.id, root: movedRoot }),
      service.removeInstallation(removable.id),
      service.resolveBinding({
        projectId: 'proj_added',
        projectRoot: join(root, 'added-project'),
        requirement: { familyId: 'added-pdk', version: null, manualConfig: null },
      }),
    ])

    await expect(service.listInstallations()).resolves.toEqual([
      expect.objectContaining({ id: moving.id, root: movedRoot }),
      expect.objectContaining({ familyId: 'added-pdk', root: addedRoot }),
    ])
    const inventory = JSON.parse(
      await readFile(join(root, 'state', 'pdk-inventory.json'), 'utf8'),
    ) as {
      bindings: Array<{ installationId: string; projectId: string }>
    }
    expect(inventory.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          installationId: moving.id,
          projectId: 'proj_moving',
        }),
        expect.objectContaining({ projectId: 'proj_added' }),
      ]),
    )
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
