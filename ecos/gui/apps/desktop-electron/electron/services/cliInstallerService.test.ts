import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliInstallerProgressEvent } from '@ecos-studio/shared'
import {
  CliInstallerService,
  type CliInstallerResourceManager,
  type CliSpawnLike,
} from './cliInstallerService'

const tempDirectories: string[] = []
const STUB_VERSION = '1.0.0'

function createTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

function createFakeEccBundle(root: string): {
  resourcesPath: string
  eccPath: string
  sha256: string
} {
  const resourcesPath = join(root, 'packaged-resources')
  const binariesDir = join(resourcesPath, 'binaries')
  mkdirSync(join(binariesDir, '_internal', 'ecc_tools_bin', 'lib'), {
    recursive: true,
  })
  const eccPath = join(binariesDir, 'ecc')
  writeFileSync(eccPath, '#!/bin/sh\necho ecc-fake\n')
  chmodSync(eccPath, 0o755)
  writeFileSync(join(binariesDir, '_internal', 'ecc_tools_bin', 'lib', 'lib.txt'), 'lib')
  return {
    resourcesPath,
    eccPath,
    sha256: createHash('sha256').update(readFileSync(eccPath)).digest('hex'),
  }
}

type FakeSpawnResult = { code: number | null; output?: string }

function createSpawnDouble(
  result: FakeSpawnResult | (() => FakeSpawnResult),
): ReturnType<typeof vi.fn> & { mock: { calls: Array<[string, string[], unknown]> } } {
  const spawn = vi.fn((_command: unknown, _args: unknown, _options: unknown) => {
    const child = new EventEmitter()
    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    Object.assign(child, { stdout, stderr })
    queueMicrotask(() => {
      const resolved = typeof result === 'function' ? result() : result
      if (resolved.output) stdout.emit('data', Buffer.from(resolved.output))
      child.emit('close', resolved.code)
    })
    return child
  })
  return spawn as unknown as ReturnType<typeof vi.fn> & {
    mock: { calls: Array<[string, string[], unknown]> }
  }
}

const spawnLike = (double: ReturnType<typeof createSpawnDouble>): CliSpawnLike =>
  double as unknown as CliSpawnLike

function createResourceManagerDouble(
  overrides: Partial<CliInstallerResourceManager> = {},
): CliInstallerResourceManager {
  return {
    downloadRegistryAssetToDirectory: vi.fn(
      async ({ destinationDir }: { destinationDir: string }) => {
        mkdirSync(join(destinationDir, '_internal'), { recursive: true })
        writeFileSync(join(destinationDir, 'ecc'), '#!/bin/sh\necho ecc-downloaded\n')
        chmodSync(join(destinationDir, 'ecc'), 0o755)
        return { version: STUB_VERSION, sha256: 'd'.repeat(64), size: 1024 }
      },
    ),
    resolveRegistryToolAsset: vi.fn(async () => ({
      version: STUB_VERSION,
      sha256: 'd'.repeat(64),
      size: 1024,
    })),
    createRuntimeEnv: vi.fn(async (baseEnv: NodeJS.ProcessEnv) => ({
      ...baseEnv,
      ECOS_SLANG: '/tools/slang/bin/slang',
      RISCV_TOOLCHAIN: '/tools/riscv',
    })),
    onManifestChanged: vi.fn(() => () => {}),
    ...overrides,
  }
}

interface ServiceFixture {
  root: string
  dataDir: string
  binDir: string
  service: CliInstallerService
  resourceManager: CliInstallerResourceManager
  spawn: ReturnType<typeof createSpawnDouble>
}

function createService(
  options: {
    resourcesPath?: string
    spawnResult?: FakeSpawnResult | (() => FakeSpawnResult)
    resourceManager?: CliInstallerResourceManager
    expectedVersion?: string
  } = {},
): ServiceFixture {
  const root = createTempDir('ecos-cli-installer-')
  const dataDir = join(root, 'ecc-runtime')
  const binDir = join(root, 'bin')
  const resourceManager = options.resourceManager ?? createResourceManagerDouble()
  const spawn = createSpawnDouble(options.spawnResult ?? { code: 0, output: 'ecc 1.0' })
  const service = new CliInstallerService({
    resourceManager,
    env: { PATH: '/usr/bin' },
    platform: 'linux',
    isPackaged: true,
    appPath: join(root, 'app'),
    resourcesPath: options.resourcesPath ?? '',
    userDataPath: join(root, 'user-data'),
    dataDir,
    binDir,
    spawn: spawnLike(spawn),
    expectedVersion: options.expectedVersion ?? STUB_VERSION,
  })
  return { root, dataDir, binDir, service, resourceManager, spawn }
}

function currentVersionDirName(dataDir: string): string {
  return basename(realpathSync(join(dataDir, 'current')))
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('CliInstallerService', () => {
  it('installs from a bundled package with layout, env file, shim, and current link', async () => {
    const root = createTempDir('ecos-cli-installer-src-')
    const bundle = createFakeEccBundle(root)
    const { dataDir, binDir, service, spawn } = createService({
      resourcesPath: bundle.resourcesPath,
    })
    const events: CliInstallerProgressEvent[] = []

    const versionDir = await service.ensureBundle({
      installShim: true,
      onProgress: (event: CliInstallerProgressEvent) => events.push(event),
    })

    expect(versionDir).toBe(join(dataDir, `1.0.0-${bundle.sha256.slice(0, 8)}`))
    expect(existsSync(join(versionDir, 'binaries', 'ecc'))).toBe(true)
    expect(existsSync(join(versionDir, 'binaries', '_internal'))).toBe(true)
    expect(currentVersionDirName(dataDir)).toBe(basename(versionDir))

    const record = JSON.parse(readFileSync(join(versionDir, 'install.json'), 'utf8'))
    expect(record).toMatchObject({
      version: STUB_VERSION,
      sha256: bundle.sha256,
      source: 'bundled',
    })
    expect(record.selfCheck.ok).toBe(true)

    const envFile = readFileSync(join(versionDir, 'env'), 'utf8')
    // Directories are single-quoted; the caller's own value stays expanded
    // outside the quotes.
    expect(envFile).toMatch(/^PATH='[^']+':\$PATH$/m)
    expect(envFile).toMatch(
      new RegExp(
        `^LD_LIBRARY_PATH='${join(versionDir, 'binaries', '_internal', 'ecc_tools_bin', 'lib')}':\\$LD_LIBRARY_PATH$`,
        'm',
      ),
    )
    expect(envFile).toContain('ECOS_SLANG=')
    expect(envFile).toContain('RISCV_TOOLCHAIN=')
    expect(envFile).not.toContain('HOME=')

    const shimPath = join(binDir, 'ecos-ecc')
    const shim = readFileSync(shimPath, 'utf8')
    const expectedEnv = join(dataDir, 'current', 'env')
    const expectedEcc = join(dataDir, 'current', 'binaries', 'ecc')
    expect(shim).toContain(`. '${expectedEnv}'; set +a`)
    expect(shim).toContain(`exec '${expectedEcc}' "$@"`)

    const status = await service.status()
    expect(status.status).toBe('ready')
    expect(status.installedVersion).toBe(STUB_VERSION)
    expect(status.source).toBe('bundled')
    expect(status.shimPath).toBe(shimPath)

    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/\.tmp-\d+[/\\]binaries[/\\]ecc$/),
      ['--version'],
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    expect(events.at(-1)).toMatchObject({ phase: 'done', progress: 1 })
  })

  it('downloads from the registry when the packaged bundle is absent', async () => {
    const { dataDir, service, resourceManager } = createService({
      resourcesPath: '',
    })

    const versionDir = await service.ensureBundle()

    const downloadCall = (
      resourceManager.downloadRegistryAssetToDirectory as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as {
      destinationDir: string
      resourceId: string
      version: string
    }
    expect(downloadCall.resourceId).toBe('tool:ecc')
    expect(downloadCall.version).toBe(STUB_VERSION)
    expect(downloadCall.destinationDir).toBe(
      join(dataDir, `.tmp-${process.pid}`, 'binaries'),
    )

    const record = JSON.parse(readFileSync(join(versionDir, 'install.json'), 'utf8'))
    expect(record.source).toBe('downloaded')
    expect(record.sha256).toBe('d'.repeat(64))
  })

  it('leaves current untouched when the download fails', async () => {
    const { dataDir, service } = createService({
      resourcesPath: '',
      resourceManager: createResourceManagerDouble({
        downloadRegistryAssetToDirectory: vi.fn(async () => {
          throw new Error('SHA256 verification failed for ecc')
        }),
      }),
    })
    const events: CliInstallerProgressEvent[] = []

    await expect(
      service.ensureBundle({
        onProgress: (event: CliInstallerProgressEvent) => events.push(event),
      }),
    ).rejects.toThrow(/SHA256 verification failed/)

    expect(existsSync(join(dataDir, 'current'))).toBe(false)
    const status = await service.status()
    expect(status.status).toBe('failed')
    expect(status.error).toContain('SHA256 verification failed')
    expect(events.at(-1)).toMatchObject({ phase: 'error' })
  })

  it('reports self-check failures but still switches current', async () => {
    const root = createTempDir('ecos-cli-installer-sc-')
    const bundle = createFakeEccBundle(root)
    const { dataDir, service } = createService({
      resourcesPath: bundle.resourcesPath,
      spawnResult: { code: 1, output: 'error while loading shared libraries' },
    })

    await service.ensureBundle({ installShim: true })

    const versionDir = join(dataDir, currentVersionDirName(dataDir))
    const record = JSON.parse(readFileSync(join(versionDir, 'install.json'), 'utf8'))
    expect(record.selfCheck.ok).toBe(false)
    expect(record.selfCheck.detail).toContain('shared libraries')

    const status = await service.status()
    expect(status.status).toBe('self-check-failed')
  })

  it('reinstalls on version drift and keeps the previous version directory', async () => {
    const root = createTempDir('ecos-cli-installer-drift-')
    const bundle = createFakeEccBundle(root)
    const first = createService({
      resourcesPath: bundle.resourcesPath,
      expectedVersion: '1.0.0',
    })
    const oldVersionDir = await first.service.ensureBundle()

    const next = new CliInstallerService({
      resourceManager: first.resourceManager,
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      isPackaged: true,
      appPath: join(root, 'app'),
      resourcesPath: bundle.resourcesPath,
      userDataPath: join(root, 'user-data'),
      dataDir: first.dataDir,
      binDir: first.binDir,
      spawn: spawnLike(createSpawnDouble({ code: 0, output: 'ecc 2.0' })),
      expectedVersion: '2.0.0',
    })
    await next.checkSyncOnStartup()

    const activeDir = join(first.dataDir, currentVersionDirName(first.dataDir))
    expect(basename(activeDir)).toBe(`2.0.0-${bundle.sha256.slice(0, 8)}`)
    expect(activeDir).not.toBe(oldVersionDir)
    expect(existsSync(oldVersionDir)).toBe(true)
    const record = JSON.parse(readFileSync(join(activeDir, 'install.json'), 'utf8'))
    expect(record.version).toBe('2.0.0')
  })

  it('cleans stale staging directories on startup', async () => {
    const root = createTempDir('ecos-cli-installer-cleanup-')
    const bundle = createFakeEccBundle(root)
    const { dataDir, service } = createService({
      resourcesPath: bundle.resourcesPath,
    })
    mkdirSync(join(dataDir, '.tmp-999'), { recursive: true })
    writeFileSync(join(dataDir, '.tmp-999', 'junk'), 'x')

    await service.checkSyncOnStartup()

    expect(existsSync(join(dataDir, '.tmp-999'))).toBe(false)
    expect(existsSync(join(dataDir, 'current'))).toBe(false)
  })

  it('reports the manual shim content when the shim path is not writable', async () => {
    const root = createTempDir('ecos-cli-installer-ro-')
    const bundle = createFakeEccBundle(root)
    const blocker = join(root, 'not-a-dir')
    writeFileSync(blocker, 'file occupying the bin path')
    const dataDir = join(root, 'ecc-runtime')
    const binDir = join(blocker, 'bin')
    const service = new CliInstallerService({
      resourceManager: createResourceManagerDouble(),
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      isPackaged: true,
      appPath: join(root, 'app'),
      resourcesPath: bundle.resourcesPath,
      userDataPath: join(root, 'user-data'),
      dataDir,
      binDir,
      spawn: spawnLike(createSpawnDouble({ code: 0 })),
    })

    await expect(service.installShim()).rejects.toThrow(
      /Unable to write [\s\S]*manually with:/,
    )
    // The bundle itself still installs and current points at a complete install,
    // but a missing shim means the host command is NOT ready.
    await service.ensureBundle()
    const versionDir = join(dataDir, currentVersionDirName(dataDir))
    expect(existsSync(join(versionDir, 'install.json'))).toBe(true)
    const status = await service.status()
    expect(status.status).toBe('failed')
    expect(status.error).toContain('shim is missing')
    expect(status.shimPath).toBeNull()
  })

  it('installs a repository-wrapper shim in development mode and disables installs', async () => {
    const root = createTempDir('ecos-cli-installer-dev-')
    const appPath = join(root, 'ecos', 'gui', 'apps', 'desktop-electron')
    mkdirSync(join(root, 'ecc'), { recursive: true })
    mkdirSync(appPath, { recursive: true })
    mkdirSync(join(root, 'ecos', 'scripts'), { recursive: true })
    const userDataPath = join(root, 'user-data')
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(root, 'ecc', 'pyproject.toml'), '[project]\n')
    writeFileSync(
      join(root, 'ecos', 'scripts', 'ecc-wrapper.sh'),
      '#!/usr/bin/env bash\n',
    )

    const dataDir = join(root, 'ecc-runtime')
    const binDir = join(root, 'bin')
    const resourceManager = createResourceManagerDouble()
    const service = new CliInstallerService({
      resourceManager,
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      isPackaged: false,
      appPath,
      userDataPath,
      dataDir,
      binDir,
      spawn: spawnLike(createSpawnDouble({ code: 0 })),
    })

    await service.installShim()

    const shim = readFileSync(join(binDir, 'ecos-ecc'), 'utf8')
    expect(shim).toContain(`. '${join(dataDir, 'env')}'; set +a`)
    expect(shim).toContain(`exec '${join(userDataPath, 'runtime-bin', 'ecc')}' "$@"`)
    expect(existsSync(join(dataDir, 'env'))).toBe(true)

    await expect(service.ensureBundle()).rejects.toThrow(/Development mode/)
    await expect(resourceManager.downloadRegistryAssetToDirectory).not.toHaveBeenCalled()
    await service.checkSyncOnStartup()
    await expect(resourceManager.resolveRegistryToolAsset).not.toHaveBeenCalled()

    const status = await service.status()
    expect(status.status).toBe('dev-wrapper')
    expect(status.shimPath).toBe(join(binDir, 'ecos-ecc'))
  })

  it('re-acquires from the embedded bundle when a fat package replaces a slim install', async () => {
    const root = createTempDir('ecos-cli-installer-transition-')
    const bundle = createFakeEccBundle(root)
    // First: a slim package installs from the registry.
    const slim = createService({ resourcesPath: '' })
    await slim.service.ensureBundle()
    expect(currentVersionDirName(slim.dataDir)).toBe(`1.0.0-${'d'.repeat(8)}`)

    // Then: the running package embeds a different bundle.
    const fat = new CliInstallerService({
      resourceManager: slim.resourceManager,
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      isPackaged: true,
      appPath: join(root, 'app'),
      resourcesPath: bundle.resourcesPath,
      userDataPath: join(root, 'user-data'),
      dataDir: slim.dataDir,
      binDir: slim.binDir,
      spawn: spawnLike(createSpawnDouble({ code: 0, output: 'ecc bundled' })),
      expectedVersion: STUB_VERSION,
    })
    await fat.checkSyncOnStartup()

    expect(currentVersionDirName(slim.dataDir)).toBe(`1.0.0-${bundle.sha256.slice(0, 8)}`)
    const record = JSON.parse(
      readFileSync(
        join(slim.dataDir, currentVersionDirName(slim.dataDir), 'install.json'),
        'utf8',
      ),
    )
    expect(record.source).toBe('bundled')
  })

  it('replaces a same-identity install whose recorded self-check failed', async () => {
    const root = createTempDir('ecos-cli-installer-repair-')
    const bundle = createFakeEccBundle(root)
    const first = createService({
      resourcesPath: bundle.resourcesPath,
      spawnResult: { code: 1, output: 'cannot open shared object file' },
    })
    const brokenDir = await first.service.ensureBundle()
    expect(currentVersionDirName(first.dataDir)).toBe(basename(brokenDir))

    // A fresh reinstall with a passing self-check must repair the directory
    // (startup drift sync does not retry environmental self-check failures).
    const second = new CliInstallerService({
      resourceManager: first.resourceManager,
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      isPackaged: true,
      appPath: join(root, 'app'),
      resourcesPath: bundle.resourcesPath,
      userDataPath: join(root, 'user-data'),
      dataDir: first.dataDir,
      binDir: first.binDir,
      spawn: spawnLike(createSpawnDouble({ code: 0, output: 'ecc ok' })),
      expectedVersion: STUB_VERSION,
    })
    await second.ensureBundle({ installShim: true })

    // The active directory is a fresh repaired copy (unique sibling name),
    // and the broken one was removed only after 'current' moved off it.
    const activeDir = join(first.dataDir, currentVersionDirName(first.dataDir))
    expect(basename(activeDir)).toMatch(
      new RegExp(`^1\\.0\\.0-${bundle.sha256.slice(0, 8)}-[0-9a-f]{8}$`),
    )
    expect(existsSync(brokenDir)).toBe(false)
    const record = JSON.parse(readFileSync(join(activeDir, 'install.json'), 'utf8'))
    expect(record.selfCheck.ok).toBe(true)
    const status = await second.status()
    expect(status.status).toBe('ready')
  })

  it('refuses to replace a foreign dangling symlink at the shim path', async () => {
    const root = createTempDir('ecos-cli-installer-foreign-')
    const bundle = createFakeEccBundle(root)
    const { binDir, service } = createService({
      resourcesPath: bundle.resourcesPath,
    })
    // A dangling symlink is an existing entry even though existsSync is false.
    const foreign = join(binDir, 'ecos-ecc')
    mkdirSync(binDir, { recursive: true })
    symlinkSync(join(binDir, 'does-not-exist'), foreign)

    await expect(service.installShim()).rejects.toThrow(
      /Refusing to overwrite .*was not generated by ECOS Studio/,
    )
  })

  it('still honors a requested shim install when deduplicating concurrent installs', async () => {
    const root = createTempDir('ecos-cli-installer-concurrent-')
    const bundle = createFakeEccBundle(root)
    let releaseDownload: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      releaseDownload = resolve
    })
    const resourceManagerWithGate = createResourceManagerDouble({
      downloadRegistryAssetToDirectory: vi.fn(
        async (request: { destinationDir: string }) => {
          await gate
          mkdirSync(join(request.destinationDir, '_internal'), { recursive: true })
          writeFileSync(join(request.destinationDir, 'ecc'), '#!/bin/sh\n')
          chmodSync(join(request.destinationDir, 'ecc'), 0o755)
          return { version: STUB_VERSION, sha256: 'd'.repeat(64), size: 1 }
        },
      ),
    })
    const fixture = createService({
      resourcesPath: '',
      resourceManager: resourceManagerWithGate,
      spawnResult: { code: 0, output: 'ecc 1.0' },
    })
    const dataDir = fixture.dataDir
    const binDir = fixture.binDir

    // A plain (drift-style) install is in flight while a second caller asks
    // for the shim to be installed as part of its deduplicated request.
    const firstInstall = fixture.service.ensureBundle()
    const secondInstall = fixture.service.ensureBundle({ installShim: true })
    releaseDownload!()
    await Promise.all([firstInstall, secondInstall])

    expect(existsSync(join(binDir, 'ecos-ecc'))).toBe(true)
    expect(existsSync(join(dataDir, 'current', 'binaries', 'ecc'))).toBe(true)
    void bundle
  })

  it('ignores a current symlink that escapes the bundle home', async () => {
    const root = createTempDir('ecos-cli-installer-escape-')
    const bundle = createFakeEccBundle(root)
    const {
      root: serviceRoot,
      dataDir,
      service,
    } = createService({
      resourcesPath: bundle.resourcesPath,
    })
    await service.ensureBundle()

    // Point current at a directory outside the bundle home.
    const outside = join(serviceRoot, 'outside')
    mkdirSync(outside, { recursive: true })
    rmSync(join(dataDir, 'current'))
    symlinkSync(outside, join(dataDir, 'current'))

    await service.regenerateEnvFile()
    expect(existsSync(join(outside, 'env'))).toBe(false)

    const status = await service.status()
    expect(status.status).toBe('failed')
    expect(status.error).toContain('incomplete')
  })

  it('reports an incomplete active install as failed instead of ready', async () => {
    const root = createTempDir('ecos-cli-installer-incomplete-')
    const bundle = createFakeEccBundle(root)
    const { service } = createService({
      resourcesPath: bundle.resourcesPath,
    })
    const versionDir = await service.ensureBundle()
    rmSync(join(versionDir, 'binaries', '_internal'), { recursive: true })

    const status = await service.status()
    expect(status.status).toBe('failed')
    expect(status.error).toContain('incomplete')
  })
})
