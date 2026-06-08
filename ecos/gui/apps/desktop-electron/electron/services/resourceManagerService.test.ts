import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

async function runFixtureCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${stderr || error.message}`))
        return
      }
      resolve()
    })
    child.on('error', reject)
  })
}

async function createPdkArchive(
  root: string,
  options: { makefileContent?: string } = {},
): Promise<{ path: string; sha256: string; size: number }> {
  const sourceRoot = join(root, 'pdk-source')
  const sourceDir = join(sourceRoot, 'icsprout55-pdk-1.10.100')
  const archive = join(root, 'ics55.tar')
  await mkdir(join(sourceDir, 'IP'), { recursive: true })
  await mkdir(join(sourceDir, 'prtech'), { recursive: true })
  await writeFile(join(sourceDir, 'README.md'), 'fixture pdk\n', 'utf8')
  if (options.makefileContent) {
    await writeFile(join(sourceDir, 'Makefile'), options.makefileContent, 'utf8')
  }
  await runFixtureCommand('tar', ['-cf', archive, '-C', sourceRoot, 'icsprout55-pdk-1.10.100'])
  const size = Buffer.byteLength(await readFile(archive))
  return {
    path: archive,
    sha256: 'fixture-pdk-sha',
    size,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

function testRegistryCachePath(cacheDir: string, registryUrl: string): string {
  const key = createHash('sha256').update(registryUrl).digest('hex').slice(0, 12)
  return join(cacheDir, `resource-registry-${key}.json`)
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

  it('builds a runtime env from active healthy Resource Manager resources', async () => {
    const root = await createTempDir('ecos-resources-')
    const resourcesDir = join(root, 'state', 'resources')
    const toolsDir = join(root, 'data', 'tools')
    const pdksDir = join(root, 'data', 'pdks')
    const packagedBin = join(root, 'packaged', 'binaries')
    const yosysRoot = join(toolsDir, 'yosys', '2026-05-13')
    const duplicateRoot = join(toolsDir, 'duplicate', '1.0')
    const inactiveRoot = join(toolsDir, 'inactive', '1.0')
    const missingRoot = join(toolsDir, 'missing', '1.0')
    const ics55Root = join(pdksDir, 'ics55', '1.10.100')
    await mkdir(join(yosysRoot, 'bin'), { recursive: true })
    await mkdir(join(duplicateRoot, 'bin'), { recursive: true })
    await mkdir(join(inactiveRoot, 'bin'), { recursive: true })
    await mkdir(ics55Root, { recursive: true })
    await mkdir(resourcesDir, { recursive: true })
    await writeFile(join(yosysRoot, 'bin', 'yosys'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(duplicateRoot, 'bin', 'duplicate'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(inactiveRoot, 'bin', 'inactive'), '#!/bin/sh\n', 'utf8')
    await chmod(join(yosysRoot, 'bin', 'yosys'), 0o755)
    await chmod(join(duplicateRoot, 'bin', 'duplicate'), 0o755)
    await chmod(join(inactiveRoot, 'bin', 'inactive'), 0o755)
    await writeFile(join(resourcesDir, 'manifest.json'), JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:yosys': {
          type: 'tool',
          name: 'yosys',
          version: '2026-05-13',
          path: yosysRoot,
          executable: 'bin/yosys',
          active: true,
          managed: true,
        },
        'tool:duplicate': {
          type: 'tool',
          name: 'duplicate',
          version: '1.0',
          path: duplicateRoot,
          executable: 'bin/duplicate',
          active: true,
          managed: true,
        },
        'tool:inactive': {
          type: 'tool',
          name: 'inactive',
          version: '1.0',
          path: inactiveRoot,
          executable: 'bin/inactive',
          active: false,
          managed: true,
        },
        'tool:missing': {
          type: 'tool',
          name: 'missing',
          version: '1.0',
          path: missingRoot,
          executable: 'bin/missing',
          active: true,
          managed: true,
        },
        'pdk:ics55': {
          type: 'pdk',
          id: 'ics55',
          name: 'ICsprout 55nm',
          pdk_id: 'ics55',
          version: '1.10.100',
          path: ics55Root,
          canonical_path: ics55Root,
          active: true,
          managed: true,
          health: 'ok',
        },
      },
    }), 'utf8')
    const service = new ResourceManagerService({
      resourcesDir,
      toolsDir,
      pdksDir,
    })
    const baseEnv = {
      PATH: [
        packagedBin,
        join(duplicateRoot, 'bin'),
        '/usr/bin',
        join(yosysRoot, 'bin'),
      ].join(':'),
      ECOS_ELECTRON_OSS_CAD_DIR: '/packaged/oss-cad-suite',
      KEEP_ME: 'yes',
    }

    const env = await service.createRuntimeEnv(baseEnv, { platform: 'linux' })

    expect(baseEnv.PATH).toBe([
      packagedBin,
      join(duplicateRoot, 'bin'),
      '/usr/bin',
      join(yosysRoot, 'bin'),
    ].join(':'))
    expect(env).not.toBe(baseEnv)
    expect(env.PATH?.split(':')).toEqual([
      packagedBin,
      join(yosysRoot, 'bin'),
      join(duplicateRoot, 'bin'),
      '/usr/bin',
    ])
    expect(env.CHIPCOMPILER_OSS_CAD_DIR).toBe(yosysRoot)
    expect(env.ECOS_ELECTRON_OSS_CAD_DIR).toBe(yosysRoot)
    expect(env.CHIPCOMPILER_ICS55_PDK_ROOT).toBe(ics55Root)
    expect(env.ICS55_PDK_ROOT).toBe(ics55Root)
    expect(env.KEEP_ME).toBe('yes')
    expect(env.PATH).not.toContain(join(inactiveRoot, 'bin'))
    expect(env.PATH).not.toContain(join(missingRoot, 'bin'))
  })

  it('returns a copied base env when no Resource Manager manifest exists', async () => {
    const root = await createTempDir('ecos-resources-')
    const service = new ResourceManagerService({
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
    })
    const baseEnv = {
      PATH: '/usr/bin',
      ECOS_ELECTRON_OSS_CAD_DIR: '/packaged/oss-cad-suite',
    }

    const env = await service.createRuntimeEnv(baseEnv, { platform: 'linux' })

    expect(env).toEqual(baseEnv)
    expect(env).not.toBe(baseEnv)
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

  it('streams remote downloads and emits byte progress while downloading a managed tool', async () => {
    const root = await createTempDir('ecos-resources-')
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
                  url: 'https://example.com/yosys.tar',
                  sha256: 'fixture-sha',
                  size: 9,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const chunks = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6]),
      new Uint8Array([7, 8, 9]),
    ]
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://example.com/yosys.tar')
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(chunk)
            }
            controller.close()
          },
        }),
        {
          status: 200,
        },
      )
    })
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
      fetchImpl: fetchImpl as typeof fetch,
      sha256Verifier: verifySha256,
    })
    const progress = vi.fn()

    await service.installResource('tool:yosys', '0.61', progress)

    const extractingEvents = progress.mock.calls
      .map(([event]) => event)
      .filter((event) => event.phase === 'extracting')
    expect(extractingEvents).not.toContainEqual(expect.objectContaining({
      progress: 0,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading',
      progress: 1 / 3,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading',
      progress: 2 / 3,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'downloading',
      progress: 1,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'extracting',
      progress: 0.05,
    }))
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'extracting',
      progress: 0.98,
    }))
  })

  it('reports the source URL and network cause when a tool download fails before a response', async () => {
    const root = await createTempDir('ecos-resources-')
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
                  url: 'https://github.com/YosysHQ/oss-cad-suite-build/releases/download/0.61/yosys.tar',
                  sha256: '',
                  size: 20,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const cause = Object.assign(new Error('Connect Timeout Error'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    })
    const fetchError = Object.assign(new TypeError('fetch failed'), { cause })
    const fetchImpl = vi.fn(async () => {
      throw fetchError
    }) as unknown as typeof fetch
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl,
    })
    const progress = vi.fn()
    const expectedMessage = 'Failed to download https://github.com/YosysHQ/oss-cad-suite-build/releases/download/0.61/yosys.tar: fetch failed (UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error)'

    await expect(service.installResource('tool:yosys', '0.61', progress)).rejects.toThrow(expectedMessage)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'error',
      message: expectedMessage,
      error: expectedMessage,
    }))
  })

  it('cancels an active tool download and removes temporary downloads', async () => {
    const root = await createTempDir('ecos-resources-')
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
                  url: 'https://example.com/yosys.tar',
                  sha256: '',
                  size: 9,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    let started = false
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        controller?.error(new DOMException('The operation was aborted.', 'AbortError'))
      })
      return new Response(
        new ReadableStream<Uint8Array>({
          start(nextController) {
            started = true
            controller = nextController
            nextController.enqueue(new Uint8Array([1, 2, 3]))
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      fetchImpl,
    })
    const progress = vi.fn()

    const install = service.installResource('tool:yosys', '0.61', progress)
    await vi.waitFor(() => {
      expect(started).toBe(true)
    })

    await expect(service.cancelResource('tool:yosys')).resolves.toEqual({
      status: 'cancelled',
      resource_id: 'tool:yosys',
    })
    await expect(install).rejects.toThrow('Cancelled download for tool:yosys')
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'tool:yosys',
      phase: 'cancelled',
      message: 'Cancelled download for tool:yosys',
      error: 'Cancelled download for tool:yosys',
    }))
    await expect(readdir(join(root, 'state', 'resources', 'downloads'))).resolves.toEqual([])
  })

  it('returns cached registry data immediately and refreshes the registry in the background', async () => {
    const root = await createTempDir('ecos-resources-')
    const cacheDir = join(root, 'cache')
    const registryUrl = 'https://example.com/registry.json'
    await mkdir(cacheDir, { recursive: true })
    await writeFile(testRegistryCachePath(cacheDir, registryUrl), JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'cached-yosys',
          display_name: 'Cached Yosys',
          description: 'Cached synthesis tool',
          category: 'synthesis',
          homepage: '',
          versions: [
            {
              version: '0.61',
              platforms: {
                'all-platform': {
                  url: 'file:///tmp/cached-yosys.tar',
                  sha256: 'fixture-sha',
                  size: 9,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }), 'utf8')
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    const service = new ResourceManagerService({
      registryUrl,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      cacheDir,
      fetchImpl: fetchImpl as typeof fetch,
    })

    const result = await withTimeout(service.listResources(), 100)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.diagnostics).toContain('Using cached registry data while refreshing in background')
    expect(result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tool:cached-yosys',
        display_name: 'Cached Yosys',
      }),
    ]))
  })

  it('installs a managed registry PDK with strip prefix and post-install steps', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root)
    const registryPath = join(root, 'registry.json')
    const postInstallRunner = vi.fn(async (command: string, args: string[], options?: { cwd?: string }) => {
      expect(command).toBe('make')
      expect(args).toEqual(['unzip'])
      expect(options?.cwd).toContain(`${join('data', 'pdks', 'ics55')}`)
      await writeFile(join(options?.cwd ?? root, 'post-install-ran.txt'), 'ok\n', 'utf8')
    })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          description: 'ICsprout 55nm open-source process design kit.',
          category: 'pdk',
          homepage: 'https://example.com/ics55',
          versions: [
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                  post_install: [
                    {
                      command: ['make', 'unzip'],
                      cwd: '.',
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')
    const verifySha256 = vi.fn(async () => true)
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      commandRunner: postInstallRunner,
      sha256Verifier: verifySha256,
    })
    const progress = vi.fn()

    await expect(service.installResource('pdk:ics55', '1.10.100', progress)).resolves.toEqual({
      status: 'started',
      resource_id: 'pdk:ics55',
      version: '1.10.100',
    })

    const destination = join(root, 'data', 'pdks', 'ics55', '1.10.100')
    const installed = await service.getResource('pdk:ics55')
    expect(installed).toMatchObject({
      id: 'pdk:ics55',
      type: 'pdk',
      status: 'installed',
      installed_version: '1.10.100',
      active: true,
      active_version: '1.10.100',
      path: destination,
      managed_root: join(root, 'data', 'pdks'),
      source: 'registry',
      actions: ['validate', 'uninstall'],
      health: expect.objectContaining({
        managed: true,
        source: 'registry',
        source_url: `file://${archive.path}`,
        sha256: archive.sha256,
      }),
    })
    await expect(readFile(join(destination, 'post-install-ran.txt'), 'utf8')).resolves.toBe('ok\n')
    expect(postInstallRunner).toHaveBeenCalledWith(
      'make',
      ['unzip'],
      expect.objectContaining({ cwd: expect.stringContaining(`${join('data', 'pdks', 'ics55')}`) }),
    )
    expect(verifySha256).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'pdk:ics55',
      phase: 'post_install',
    }))
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({
      resource_id: 'pdk:ics55',
      phase: 'done',
      progress: 1,
    }))

    const manifest = JSON.parse(
      await readFile(join(root, 'state', 'resources', 'manifest.json'), 'utf8'),
    ) as { installed: Record<string, unknown> }
    expect(manifest.installed['pdk:ics55']).toMatchObject({
      type: 'pdk',
      id: 'ics55',
      name: 'ics55',
      pdk_id: 'ics55',
      version: '1.10.100',
      sha256: archive.sha256,
      source: 'registry',
      source_url: `file://${archive.path}`,
      canonical_path: destination,
      path: destination,
      active: true,
      managed: true,
      health: 'ok',
      detected_file_groups: {
        directories: ['IP', 'prtech'],
        files: ['README.md', 'post-install-ran.txt'],
      },
    })
  })

  it('marks managed registry PDKs updateable and updates them through the PDK install path', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          description: 'ICsprout 55nm open-source process design kit.',
          category: 'pdk',
          homepage: 'https://example.com/ics55',
          versions: [
            {
              version: '1.10.101',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                },
              },
            },
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                },
              },
            },
          ],
        },
      ],
    }), 'utf8')
    await mkdir(join(root, 'state', 'resources'), { recursive: true })
    await writeFile(join(root, 'state', 'resources', 'manifest.json'), JSON.stringify({
      schema_version: 1,
      resources_dir: join(root, 'state', 'resources'),
      tools_dir: join(root, 'data', 'tools'),
      pdks_dir: join(root, 'data', 'pdks'),
      installed: {
        'pdk:ics55': {
          type: 'pdk',
          id: 'ics55',
          name: 'ics55',
          pdk_id: 'ics55',
          version: '1.10.100',
          sha256: 'old-sha',
          source: 'registry',
          source_url: 'file:///old/ics55.tar',
          canonical_path: join(root, 'data', 'pdks', 'ics55', '1.10.100'),
          path: join(root, 'data', 'pdks', 'ics55', '1.10.100'),
          detected_files: ['IP', 'prtech'],
          detected_file_groups: {
            directories: ['IP', 'prtech'],
            files: [],
          },
          imported_at: '2026-01-01T00:00:00Z',
          active: true,
          managed: true,
          health: 'ok',
        },
      },
    }), 'utf8')
    const service = new ResourceManagerService({
      registryUrl: `file://${registryPath}`,
      resourcesDir: join(root, 'state', 'resources'),
      toolsDir: join(root, 'data', 'tools'),
      pdksDir: join(root, 'data', 'pdks'),
      sha256Verifier: vi.fn(async () => true),
    })

    await expect(service.getResource('pdk:ics55')).resolves.toMatchObject({
      status: 'update_available',
      installed_version: '1.10.100',
      available_versions: ['1.10.101', '1.10.100'],
      active: true,
      actions: ['validate', 'update', 'uninstall'],
    })
    await expect(service.updateResource('pdk:ics55')).resolves.toEqual({
      status: 'started',
      resource_id: 'pdk:ics55',
      version: '1.10.101',
    })
    await expect(service.getResource('pdk:ics55')).resolves.toMatchObject({
      status: 'installed',
      installed_version: '1.10.101',
      active: true,
      active_version: '1.10.101',
      actions: ['validate', 'uninstall'],
    })
  })

  it('pre-downloads PDK release assets before running Makefile post-install steps', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root, {
      makefileContent: [
        'RELEASE_FILE_LIB := ics55_mock_liberty.tar.bz2 \\',
        '                    ics55_mock_gds.tar.bz2',
        'RELEASE_FILE := $(RELEASE_FILE_LIB)',
        '',
        'unzip:',
        '\t@echo unzip',
        '',
      ].join('\n'),
    })
    const archiveBytes = await readFile(archive.path)
    const registryPath = join(root, 'registry.json')
    const archiveUrl = 'https://github.com/openecos-projects/icsprout55-pdk/archive/refs/tags/v1.10.100.tar.gz'
    const fetchedUrls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const requestUrl = String(url)
      fetchedUrls.push(requestUrl)
      if (requestUrl === archiveUrl) {
        return new Response(archiveBytes)
      }
      return new Response(new TextEncoder().encode(`payload for ${requestUrl}`))
    })
    const postInstallRunner = vi.fn(async (_command: string, _args: string[], options?: { cwd?: string }) => {
      const cwd = options?.cwd ?? root
      await expect(readFile(join(cwd, 'ics55_mock_liberty.tar.bz2'), 'utf8')).resolves.toContain('payload for')
      await expect(readFile(join(cwd, 'ics55_mock_gds.tar.bz2'), 'utf8')).resolves.toContain('payload for')
    })
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          versions: [
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: archiveUrl,
                  sha256: 'fixture-pdk-sha',
                  size: archiveBytes.byteLength,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                  post_install: [
                    {
                      command: ['make', 'unzip'],
                      cwd: '.',
                    },
                  ],
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
      commandRunner: postInstallRunner,
      fetchImpl: fetchImpl as typeof fetch,
      sha256Verifier: vi.fn(async () => true),
    })

    await service.installResource('pdk:ics55', '1.10.100')

    expect(fetchedUrls).toEqual(expect.arrayContaining([
      archiveUrl,
      'https://github.com/openecos-projects/icsprout55-pdk/releases/download/v1.10.100/ics55_mock_liberty.tar.bz2',
      'https://github.com/openecos-projects/icsprout55-pdk/releases/download/v1.10.100/ics55_mock_gds.tar.bz2',
    ]))
    expect(postInstallRunner).toHaveBeenCalledTimes(1)
  })

  it('keeps post-install command failures concise when commands emit large output', async () => {
    const root = await createTempDir('ecos-resources-')
    const archive = await createPdkArchive(root)
    const registryPath = join(root, 'registry.json')
    await writeFile(registryPath, JSON.stringify({
      schema_version: 2,
      tools: [],
      pdks: [
        {
          id: 'ics55',
          display_name: 'ICsprout 55nm PDK',
          versions: [
            {
              version: '1.10.100',
              platforms: {
                'all-platform': {
                  url: `file://${archive.path}`,
                  sha256: archive.sha256,
                  size: archive.size,
                  strip_prefix: 'icsprout55-pdk-1.10.100',
                  post_install: [
                    {
                      command: [
                        process.execPath,
                        '-e',
                        "process.stderr.write('x'.repeat(12000)); process.exit(7)",
                      ],
                      cwd: '.',
                    },
                  ],
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
      sha256Verifier: vi.fn(async () => true),
    })

    try {
      await service.installResource('pdk:ics55', '1.10.100')
      throw new Error('Expected post-install command to fail')
    } catch (error) {
      expect(error).toEqual(expect.objectContaining({
        message: expect.stringMatching(/failed with exit code 7/),
      }))
      expect(error).toEqual(expect.objectContaining({
        message: expect.not.stringMatching(/x{10000}/),
      }))
      expect(error).toEqual(expect.objectContaining({
        message: expect.not.stringMatching(/x{3000}/),
      }))
    }
  })
})
