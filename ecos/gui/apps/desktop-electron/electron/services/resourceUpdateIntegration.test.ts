import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, chmod, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResourceManagerService } from './resourceManagerService'
import { ResourceUpdateScheduler } from './resourceUpdateScheduler'
import { assessRunStaleness, assertRunResourcesFresh } from './resourceStalenessGuard'
import { EccRpcSidecarProcess } from './frontendRpc/sidecarProcess'

vi.mock('./logger', () => ({
  electronLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    status: vi.fn(),
    warn: vi.fn(),
  },
}))

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function fixture(registry: () => unknown) {
  const root = await mkdtemp(join(tmpdir(), 'pr251-repro-'))
  roots.push(root)
  const resourcesDir = join(root, 'resources')
  await mkdir(resourcesDir)
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request) => new Response(JSON.stringify(registry())),
  )
  const service = new ResourceManagerService({
    resourcesDir,
    cacheDir: join(root, 'cache'),
    toolsDir: join(root, 'tools'),
    pdksDir: join(root, 'pdks'),
    mpcsDir: join(root, 'mpcs'),
    registryUrl: 'https://example.test/registry.json',
    fetchImpl: fetchImpl as typeof fetch,
  })
  return { root, resourcesDir, service, fetchImpl }
}

function registryWithTool(sha: string) {
  return {
    schema_version: 2,
    pdks: [],
    mpcs: [],
    tools: [
      {
        name: 'demo',
        display_name: 'Demo',
        versions: [
          {
            version: '1.0',
            platforms: {
              'all-platform': {
                url: 'https://example.test/demo.tar.gz',
                sha256: sha,
                size: 1,
              },
            },
          },
        ],
      },
    ],
  }
}

it.each([
  ['metadata', 'headers'],
  ['metadata', 'body'],
  ['checksum', 'headers'],
  ['checksum', 'body'],
])('recovers automatic checks after a stalled %s %s request', async (source, phase) => {
  const registry = registryWithTool('b'.repeat(64))
  registry.tools[0].versions[0].version = 'latest'
  Object.assign(registry.tools[0].versions[0].platforms['all-platform'], {
    [source === 'metadata' ? 'metadata_url' : 'sha256_url']:
      'https://example.test/update',
  })
  const { root, resourcesDir, service, fetchImpl } = await fixture(() => registry)
  const toolRoot = join(root, 'tools', 'demo', 'latest')
  await mkdir(join(toolRoot, 'bin'), { recursive: true })
  await writeFile(join(toolRoot, 'bin', 'demo'), '#!/bin/sh\n')
  await chmod(join(toolRoot, 'bin', 'demo'), 0o755)
  await writeFile(
    join(resourcesDir, 'manifest.json'),
    JSON.stringify({
      schema_version: 3,
      installed: {
        'tool:demo': {
          type: 'tool',
          name: 'demo',
          version: 'latest',
          path: toolRoot,
          executable: 'bin/demo',
          detected_executables: ['bin/demo'],
          active: true,
          managed: true,
          sha256: 'a'.repeat(64),
        },
      },
    }),
  )
  let stalled = true
  fetchImpl.mockImplementation(async (url, init?: RequestInit) => {
    if (url !== 'https://example.test/update')
      return new Response(JSON.stringify(registry))
    if (!stalled)
      return new Response(
        source === 'metadata'
          ? JSON.stringify({ sha256: 'b'.repeat(64), size: 1 })
          : 'b'.repeat(64),
      )
    const signal = init?.signal
    if (!signal) throw new Error('Update fetch must supply an abort signal')
    if (phase === 'headers')
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    return new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), {
            once: true,
          })
        },
      }),
    )
  })
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal)
  const timeout = vi
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation((milliseconds) =>
      nativeTimeout(milliseconds === 8_000 ? 20 : milliseconds),
    )
  let now = Date.now()
  const emit = vi.fn()
  const scheduler = new ResourceUpdateScheduler({
    resourceManagerService: service,
    emit,
    now: () => now,
  })
  try {
    await scheduler.runCycle('startup')
    expect(timeout).toHaveBeenCalledWith(8_000)
    expect((await service.getResource('tool:demo')).health.update_check).toMatchObject({
      status: 'error',
    })
    expect(emit).not.toHaveBeenCalled()
    stalled = false
    now += 7 * 60 * 60 * 1000
    await scheduler.runCycle('interval')
    expect((await service.getResource('tool:demo')).status).toBe('update_available')
    expect(emit).toHaveBeenCalledTimes(1)
  } finally {
    timeout.mockRestore()
  }
})

it('restarts an already loaded runtime after a same-path ECC-FE package changes', async () => {
  const { root, resourcesDir, service } = await fixture(() => ({
    schema_version: 2,
    tools: [],
    pdks: [],
    mpcs: [],
  }))
  const toolRoot = join(root, 'tools', 'ecc-fe', 'latest')
  await mkdir(join(toolRoot, 'bin'), { recursive: true })
  await mkdir(join(toolRoot, 'fecompiler'), { recursive: true })
  await writeFile(join(toolRoot, 'bin', 'ecc-fe'), '#!/bin/sh\n')
  await chmod(join(toolRoot, 'bin', 'ecc-fe'), 0o755)
  const command = join(toolRoot, 'runtime.cjs')
  const program = (version: string) => `
    const version = ${JSON.stringify(version)};
    let buffer = Buffer.alloc(0);
    process.stdin.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const end = buffer.indexOf('\\r\\n\\r\\n');
        if (end < 0) return;
        const length = Number(buffer.subarray(0, end).toString().match(/Content-Length: (\\d+)/i)[1]);
        if (buffer.length < end + 4 + length) return;
        const request = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
        buffer = buffer.subarray(end + 4 + length);
        const result = request.method === 'rpc.shutdown' ? {ok:true} : {version};
        const payload = JSON.stringify({jsonrpc:'2.0',id:request.id,result});
        process.stdout.write('Content-Length: ' + Buffer.byteLength(payload) + '\\r\\n\\r\\n' + payload);
        if (request.method === 'rpc.shutdown') setTimeout(() => process.exit(0), 10);
      }
    });`
  const install = async (version: string, sha256: string) => {
    await writeFile(command, program(version))
    await writeFile(
      join(resourcesDir, 'manifest.json'),
      JSON.stringify({
        schema_version: 3,
        installed: {
          'tool:ecc-fe': {
            type: 'tool',
            name: 'ecc-fe',
            version: 'latest',
            path: toolRoot,
            executable: 'bin/ecc-fe',
            detected_executables: ['bin/ecc-fe'],
            active: true,
            managed: true,
            sha256,
          },
        },
      }),
    )
  }
  await install('old', 'a'.repeat(64))
  const backendEnv = await service.createRuntimeEnv(process.env, {
    platform: process.platform,
  })
  expect(backendEnv.ECOS_FE_RUNTIME_SHA256).toBeUndefined()
  const sidecar = new EccRpcSidecarProcess({
    command: process.execPath,
    commandArgs: [command],
    managementRpc: true,
    envProvider: () =>
      service.createRuntimeEnv(process.env, {
        platform: process.platform,
        designTool: 'frontend',
      }),
  })
  try {
    const oldClient = await sidecar.start()
    expect(await oldClient.call('rpc.ping')).toEqual({ version: 'old' })
    expect(await sidecar.start()).toBe(oldClient)
    await install('new', 'b'.repeat(64))
    expect(
      await service.createRuntimeEnv(process.env, { platform: process.platform }),
    ).toEqual(backendEnv)
    const newClient = await sidecar.start()
    expect(newClient).not.toBe(oldClient)
    expect(await newClient.call('rpc.ping')).toEqual({ version: 'new' })
    expect(await sidecar.start()).toBe(newClient)
  } finally {
    await sidecar.shutdown()
  }
})

it('pre-run assessment performs zero network requests with no registry cache', async () => {
  const { service, fetchImpl } = await fixture(() => ({
    schema_version: 2,
    tools: [],
    pdks: [],
    mpcs: [],
  }))
  await assessRunStaleness({
    resourceManagerService: service,
    pdkInventoryService: service.getPdkInventoryService(),
    workspaceDirectory: null,
  })
  expect(fetchImpl).not.toHaveBeenCalled()
})

it('pre-run assessment reads a disk registry cache without refreshing it', async () => {
  const { root, resourcesDir, service, fetchImpl } = await fixture(() =>
    registryWithTool('a'.repeat(64)),
  )
  await service.refreshRegistry()
  fetchImpl.mockClear()
  const restarted = new ResourceManagerService({
    resourcesDir,
    cacheDir: join(root, 'cache'),
    toolsDir: join(root, 'tools'),
    pdksDir: join(root, 'pdks'),
    mpcsDir: join(root, 'mpcs'),
    registryUrl: 'https://example.test/registry.json',
    fetchImpl: fetchImpl as typeof fetch,
  })
  await assessRunStaleness({
    resourceManagerService: restarted,
    pdkInventoryService: restarted.getPdkInventoryService(),
    workspaceDirectory: null,
  })
  expect(fetchImpl).not.toHaveBeenCalled()
  expect((await restarted.listCachedResources()).resources).toContainEqual(
    expect.objectContaining({ id: 'tool:demo' }),
  )
})

it('automatic checks detect a republish after six hours in the same session', async () => {
  let sha = 'a'.repeat(64)
  const { root, resourcesDir, service, fetchImpl } = await fixture(() =>
    registryWithTool(sha),
  )
  const toolRoot = join(root, 'tools', 'demo', '1.0')
  await mkdir(join(toolRoot, 'bin'), { recursive: true })
  await writeFile(join(toolRoot, 'bin', 'demo'), '#!/bin/sh\n')
  await chmod(join(toolRoot, 'bin', 'demo'), 0o755)
  await writeFile(
    join(resourcesDir, 'manifest.json'),
    JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:demo': {
          type: 'tool',
          name: 'demo',
          version: '1.0',
          path: toolRoot,
          executable: 'bin/demo',
          detected_executables: ['bin/demo'],
          active: true,
          managed: true,
          sha256: sha,
        },
      },
    }),
  )
  let now = Date.now()
  const emit = vi.fn()
  const scheduler = new ResourceUpdateScheduler({
    resourceManagerService: service,
    emit,
    now: () => now,
  })
  await scheduler.runCycle('startup')
  expect((await service.getResource('tool:demo')).status).toBe('installed')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  sha = 'b'.repeat(64)
  now += 7 * 60 * 60 * 1000
  await scheduler.runCycle('interval')
  expect((await service.getResource('tool:demo')).status).toBe('update_available')
  expect(emit).toHaveBeenCalled()
})

it('managed PDK inventory is checked for same-version checksum drift', async () => {
  const { root, service } = await fixture(() => ({
    schema_version: 2,
    tools: [],
    mpcs: [],
    pdks: [
      {
        id: 'demo-pdk',
        display_name: 'Demo PDK',
        versions: [
          {
            version: '1.0',
            platforms: {
              'all-platform': {
                url: 'https://example.test/pdk.tar.gz',
                sha256: 'b'.repeat(64),
                size: 1,
              },
            },
          },
        ],
      },
    ],
  }))
  const pdkRoot = join(root, 'pdks', 'demo-pdk', '1.0')
  await mkdir(pdkRoot, { recursive: true })
  await service.getPdkInventoryService().registerManagedInstallation({
    id: 'pdk:demo-pdk:managed:1.0',
    familyId: 'demo-pdk',
    displayName: 'Demo PDK',
    root: pdkRoot,
    version: '1.0',
    registrySha256: 'a'.repeat(64),
  })
  const result = await service.checkResourceUpdates()
  expect(result.resources).toContainEqual(
    expect.objectContaining({
      resource_id: 'pdk:demo-pdk:managed:1.0',
      update_available: true,
    }),
  )
  expect(await service.getResource('pdk:demo-pdk:managed:1.0')).toMatchObject({
    status: 'update_available',
    update_kind: 'rebuild',
    actions: ['validate', 'update', 'uninstall'],
    health: { update_check: { stale: false } },
  })
  const emit = vi.fn()
  await new ResourceUpdateScheduler({ resourceManagerService: service, emit }).runCycle(
    'focus',
  )
  expect(emit).toHaveBeenCalledWith({
    resources: [
      expect.objectContaining({
        resource_id: 'pdk:demo-pdk:managed:1.0',
        update_kind: 'rebuild',
      }),
    ],
  })
  const projectRoot = join(root, 'project')
  await service.getPdkInventoryService().bindInstallation({
    projectId: 'demo',
    projectRoot,
    installationId: 'pdk:demo-pdk:managed:1.0',
    requirement: { familyId: 'demo-pdk', version: '1.0', manualConfig: null },
  })
  await expect(
    assessRunStaleness({
      resourceManagerService: service,
      pdkInventoryService: service.getPdkInventoryService(),
      workspaceDirectory: join(projectRoot, 'ws_1'),
    }),
  ).resolves.toEqual([
    expect.objectContaining({ id: 'pdk:demo-pdk:managed:1.0', update_kind: 'rebuild' }),
  ])
  const otherRoot = join(root, 'pdks', 'other', '1.0')
  await mkdir(otherRoot, { recursive: true })
  await service.getPdkInventoryService().registerManagedInstallation({
    id: 'pdk:other:managed:1.0',
    familyId: 'other',
    displayName: 'Other PDK',
    root: otherRoot,
    version: '1.0',
    registrySha256: 'a'.repeat(64),
  })
  await service.getPdkInventoryService().bindInstallation({
    projectId: 'other',
    projectRoot: join(root, 'other-project'),
    installationId: 'pdk:other:managed:1.0',
    requirement: { familyId: 'other', version: '1.0', manualConfig: null },
  })
  await service.getPdkInventoryService().removeInstallation('pdk:other:managed:1.0')
  await expect(service.getPdkInventoryService().listBindings()).resolves.toEqual([
    expect.objectContaining({ projectId: 'demo' }),
  ])
  await expect(
    assessRunStaleness({
      resourceManagerService: service,
      pdkInventoryService: service.getPdkInventoryService(),
      workspaceDirectory: join(projectRoot, 'ws_1'),
    }),
  ).resolves.toEqual([expect.objectContaining({ id: 'pdk:demo-pdk:managed:1.0' })])
})

it('a non-boolean allowStaleResources does not bypass the confirmation', () => {
  expect(() =>
    assertRunResourcesFresh(
      [
        {
          id: 'tool:demo',
          display_name: 'Demo',
          installed_version: '1.0',
          latest_version: '1.1',
          update_kind: 'version',
        },
      ],
      'false' as unknown as boolean,
      'workspace.run',
    ),
  ).toThrow('allowStaleResources must be a boolean')
})

it('a managed rolling tool with no installed checksum is not falsely reported as republished', async () => {
  const registry = registryWithTool('a'.repeat(64))
  registry.tools[0].versions[0].version = 'latest'
  Object.assign(registry.tools[0].versions[0].platforms['all-platform'], {
    metadata_url: 'https://example.test/demo.metadata.json',
  })
  const { root, resourcesDir, service, fetchImpl } = await fixture(() => registry)
  fetchImpl.mockImplementation(
    async (...args: unknown[]) =>
      new Response(
        JSON.stringify(
          args[0] === 'https://example.test/demo.metadata.json'
            ? {
                sha256: 'a'.repeat(64),
                size: 1,
                commit: 'c'.repeat(40),
                built_at: '2026-10-01',
              }
            : registry,
        ),
      ),
  )
  const toolRoot = join(root, 'tools', 'demo', 'latest')
  await mkdir(join(toolRoot, 'bin'), { recursive: true })
  await writeFile(join(toolRoot, 'bin', 'demo'), '#!/bin/sh\n')
  await chmod(join(toolRoot, 'bin', 'demo'), 0o755)
  await writeFile(
    join(resourcesDir, 'manifest.json'),
    JSON.stringify({
      schema_version: 1,
      installed: {
        'tool:demo': {
          type: 'tool',
          name: 'demo',
          version: 'latest',
          path: toolRoot,
          executable: 'bin/demo',
          detected_executables: ['bin/demo'],
          active: true,
          managed: true,
        },
      },
    }),
  )
  await service.checkResourceUpdates()
  const resource = await service.getResource('tool:demo')
  expect(resource.checksum_missing).toBe(true)
  expect(resource.status).toBe('installed')
})
