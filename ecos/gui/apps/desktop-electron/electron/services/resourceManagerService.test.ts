import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResourceManagerService } from './resourceManagerService'

const tempDirectories: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

async function createFixtureArchive(root: string): Promise<{ path: string; sha256: string; size: number }> {
  const archive = join(root, 'yosys.tar')
  const payload = 'fake archive payload'
  await writeFile(archive, payload, 'utf8')
  return {
    path: archive,
    sha256: 'fixture-sha',
    size: Buffer.byteLength(payload),
  }
}

describe('ResourceManagerService', () => {
  afterEach(async () => {
    await Promise.all(
      tempDirectories.splice(0).map((directory) =>
        rm(directory, { force: true, recursive: true }),
      ),
    )
  })

  it('lists registry resources and imported PDKs from the desktop manifest', async () => {
    const root = await createTempDir('ecos-resources-')
    const registryPath = join(root, 'registry.json')
    const pdkPath = join(root, 'pdks', 'ics55')
    await mkdir(pdkPath, { recursive: true })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          homepage: 'https://example.com/yosys',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: 'file:///tmp/yosys.tar',
                  sha256: 'sha',
                  size: 12,
                },
              },
            },
          ],
        },
      ],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICSPROUT 55nm PDK',
          description: 'Integrated Circuit Systems 55nm PDK',
          category: 'pdk',
          homepage: 'https://example.com/ics55',
          versions: [
            {
              version: '1.01',
              platforms: {
                'all-platform': {
                  url: 'file:///tmp/ics55.tar',
                  sha256: 'pdk-sha',
                  size: 432,
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')

    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
    })
    const imported = await service.importPdkPath(pdkPath)
    await service.activatePdk(imported.id)

    const result = await service.listResources()

    expect(result.diagnostics).toEqual([])
    expect(result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool:yosys',
        type: 'tool',
        status: 'available',
        available_versions: ['0.61'],
        actions: ['install'],
      }),
      expect.objectContaining({
        id: 'pdk:ics55',
        type: 'pdk',
        status: 'installed',
        active: true,
        path: pdkPath,
        actions: ['validate', 'remove_reference'],
      }),
    ]))
  })

  it('installs a managed tool and emits progress without using the legacy server', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createFixtureArchive(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          homepage: '',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const extract = vi.fn(async (_archivePath: string, destination: string) => {
      await mkdir(join(destination, 'bin'), { recursive: true })
      const executable = join(destination, 'bin', 'yosys')
      await writeFile(executable, '#!/bin/sh\n', 'utf8')
      await chmod(executable, 0o755)
    })
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      archiveExtractor: extract,
      sha256Verifier: verifySha256,
    })
    const progress = vi.fn()

    await expect(service.installResource('tool:yosys', '0.61', progress)).resolves.toEqual({
      status: 'started',
      resource_id: 'tool:yosys',
      version: '0.61',
    })

    const installed = await service.getResource('tool:yosys')
    expect(installed).toMatchObject({
      id: 'tool:yosys',
      status: 'installed',
      installed_version: '0.61',
      path: join(root, 'data', 'tools', 'yosys', '0.61'),
      actions: ['uninstall'],
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'tool:yosys',
      phase: 'downloading',
    }))
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      resource_id: 'tool:yosys',
      phase: 'done',
      progress: 1,
    }))
    expect(extract).toHaveBeenCalledTimes(1)
    expect(verifySha256).toHaveBeenCalledTimes(1)

    const manifest = JSON.parse(
      await readFile(join(root, 'state', 'resources', 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, unknown> }
    expect(manifest.installed['tool:yosys']).toMatchObject({
      version: '0.61',
      managed: true,
    })
  })
})
