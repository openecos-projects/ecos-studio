import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { CliInstallerEnvWriter } from './cliInstallerEnv'
import { ResourceManagerService } from './resourceManagerService'

const exec = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  )
})

async function fixture(working = true) {
  const root = await mkdtemp(join(tmpdir(), 'ecos-kepler-'))
  temporaryDirectories.push(root)
  const source = join(root, 'source')
  await mkdir(join(source, 'bin'), { recursive: true })
  await mkdir(join(source, 'lib'))
  if (working) await writeFile(join(source, 'lib', 'runtime-marker'), '')
  await writeFile(
    join(source, 'bin', 'kepler-formal'),
    '#!/bin/sh\ntest -f "$LD_LIBRARY_PATH/runtime-marker" || exit 127\necho kepler-formal-fixture\n',
    { mode: 0o755 },
  )
  await writeFile(
    join(source, 'kepler-formal'),
    '#!/bin/sh\nexport LD_LIBRARY_PATH="$(dirname "$0")/lib"\nexec "$(dirname "$0")/bin/kepler-formal" "$@"\n',
    { mode: 0o755 },
  )
  const archive = join(root, 'kepler.tar.gz')
  await exec('tar', ['-czf', archive, '-C', source, '.'])
  const bytes = await readFile(archive)
  const registryPath = join(root, 'registry.json')
  await writeFile(
    registryPath,
    JSON.stringify({
      schema_version: 2,
      tools: [
        {
          name: 'kepler-formal',
          versions: [
            {
              version: '0.5.0',
              platforms: {
                'all-platform': {
                  url: `file://${archive}`,
                  sha256: createHash('sha256').update(bytes).digest('hex'),
                  size: bytes.length,
                },
              },
            },
          ],
        },
      ],
      pdks: [],
    }),
  )
  const resourcesDir = join(root, 'state')
  const service = new ResourceManagerService({
    resourcesDir,
    toolsDir: join(root, 'tools'),
    pdksDir: join(root, 'pdks'),
    mpcsDir: join(root, 'mpcs'),
    cacheDir: join(root, 'cache'),
    registryUrl: `file://${registryPath}`,
  })
  return { root, source, service }
}

it('installs Kepler with its library wrapper and exports its root to the GUI and CLI', async () => {
  const { root, service } = await fixture()
  await service.installResource('tool:kepler-formal')
  const installedRoot = join(root, 'tools', 'kepler-formal', '0.5.0')
  const env = await service.createRuntimeEnv(
    { PATH: '/usr/bin:/bin' },
    { platform: 'linux' },
  )
  expect(env.CHIPCOMPILER_KEPLER_FORMAL_ROOT).toBe(installedRoot)
  expect((await exec('kepler-formal', ['--version'], { env })).stdout.trim()).toBe(
    'kepler-formal-fixture',
  )

  const writer = new CliInstallerEnvWriter({
    resourceManager: service,
    platform: 'linux',
    eccRuntimeOptions: () => ({
      appPath: root,
      cwd: root,
      env: { PATH: '/usr/bin:/bin' },
      isPackaged: true,
      platform: 'linux',
      userDataPath: join(root, 'user-data'),
      dataHome: root,
    }),
  })
  await writer.writeEnvFile(root, null)
  const cli = await exec(
    '/bin/sh',
    [
      '-c',
      'set -a; . "$1"; "$CHIPCOMPILER_KEPLER_FORMAL_ROOT/kepler-formal" --version',
      'kepler-check',
      join(root, 'env'),
    ],
    { env: { PATH: '/usr/bin:/bin' } },
  )
  expect(cli.stdout.trim()).toBe('kepler-formal-fixture')
})

it('uses the wrapper for existing imports whose recorded executable is the raw binary', async () => {
  const { source, service } = await fixture()
  await service.importLocalPath('tool:kepler-formal', source)
  const env = await service.createRuntimeEnv(
    { PATH: '/usr/bin:/bin' },
    { platform: 'linux' },
  )
  expect(env.CHIPCOMPILER_KEPLER_FORMAL_ROOT).toBe(source)
  expect((await exec('kepler-formal', ['--version'], { env })).stdout.trim()).toBe(
    'kepler-formal-fixture',
  )
})

it('supports a bin-only Kepler installation and stops exporting it after uninstall', async () => {
  const { source, service } = await fixture()
  await rm(join(source, 'kepler-formal'))
  await writeFile(
    join(source, 'bin', 'kepler-formal'),
    '#!/bin/sh\necho kepler-nix-fixture\n',
  )
  await service.importLocalPath('tool:kepler-formal', source)
  const env = await service.createRuntimeEnv(
    { PATH: '/usr/bin:/bin' },
    { platform: 'linux' },
  )
  expect(env.CHIPCOMPILER_KEPLER_FORMAL_ROOT).toBe(source)
  expect((await exec('kepler-formal', ['--version'], { env })).stdout.trim()).toBe(
    'kepler-nix-fixture',
  )
  await service.uninstallResource('tool:kepler-formal')
  expect(await service.createRuntimeEnv({}, { platform: 'linux' })).toEqual({})
})

it('rejects an unusable Kepler package without replacing the working installation', async () => {
  const { source } = await fixture()
  const broken = await fixture(false)
  await broken.service.importLocalPath('tool:kepler-formal', source)
  await expect(broken.service.installResource('tool:kepler-formal')).rejects.toThrow(
    '127',
  )
  const env = await broken.service.createRuntimeEnv(
    { PATH: '/usr/bin:/bin' },
    { platform: 'linux' },
  )
  expect(env.CHIPCOMPILER_KEPLER_FORMAL_ROOT).toBe(source)
  expect((await exec('kepler-formal', ['--version'], { env })).stdout.trim()).toBe(
    'kepler-formal-fixture',
  )
})
