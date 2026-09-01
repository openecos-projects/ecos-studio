import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import afterPackLinuxSandbox from './after-pack-linux-sandbox.mjs'

const tempDirs: string[] = []

async function writeRuntimeAdapter(appOutDir: string): Promise<void> {
  const binariesDir = join(appOutDir, 'resources', 'binaries')
  const adapterPath = join(binariesDir, 'ecos-ecc-runtime-adapter')
  await mkdir(binariesDir, { recursive: true })
  await writeFile(
    adapterPath,
    '#!/bin/sh\nif [ "$1" = --help ]; then exit 0; fi\n[ "$1" = --stdio ] && [ "$2" = --persistent-db ] || exit 64\n',
  )
  await chmod(adapterPath, 0o755)
}

async function writeHelpOnlyRuntimeAdapter(appOutDir: string): Promise<void> {
  const binariesDir = join(appOutDir, 'resources', 'binaries')
  const adapterPath = join(binariesDir, 'ecos-ecc-runtime-adapter')
  await mkdir(binariesDir, { recursive: true })
  await writeFile(adapterPath, '#!/bin/sh\n[ "$1" = --help ] || exit 64\n')
  await chmod(adapterPath, 0o755)
}

async function writeInvalidRuntimeAdapter(appOutDir: string): Promise<void> {
  const binariesDir = join(appOutDir, 'resources', 'binaries')
  const adapterPath = join(binariesDir, 'ecos-ecc-runtime-adapter')
  await mkdir(binariesDir, { recursive: true })
  await writeFile(adapterPath, '#!/bin/sh\nexit 64\n')
  await chmod(adapterPath, 0o755)
}

async function writePackagedAgent(appOutDir: string): Promise<void> {
  const agentDir = join(appOutDir, 'resources', 'agent')
  const agentPath = join(agentDir, 'ecos-agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(
    agentPath,
    '#!/bin/sh\n[ "$1" = --version ] || exit 64\nprintf "ecos-agent 0.1.0\\n"\n',
  )
  await writeFile(
    join(agentDir, 'agent-provider.json'),
    JSON.stringify({
      command: './ecos-agent',
      protocolVersion: 1,
      providerId: 'ecos_agent',
    }),
  )
  await chmod(agentPath, 0o755)
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => {
      await import('node:fs/promises').then(({ rm }) =>
        rm(dir, { force: true, recursive: true }),
      )
    }),
  )
  tempDirs.length = 0
})

describe('afterPackLinuxSandbox', () => {
  it('wraps the Linux executable so it can add --no-sandbox before Chromium starts', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    const executablePath = join(appOutDir, 'ecos-studio')
    await writeFile(executablePath, 'binary-placeholder')
    await writeRuntimeAdapter(appOutDir)
    await writePackagedAgent(appOutDir)

    await afterPackLinuxSandbox({
      appOutDir,
      electronPlatformName: 'linux',
      packager: {
        appInfo: {
          productFilename: 'ecos-studio',
        },
        executableName: 'ecos-studio',
      },
    })

    const renamedBinary = await readFile(join(appOutDir, 'ecos-studio-bin'), 'utf8')
    const wrapperScript = await readFile(executablePath, 'utf8')

    expect(renamedBinary).toBe('binary-placeholder')
    expect(wrapperScript).toContain('exec "$BINARY" --no-sandbox "$@"')
    expect(wrapperScript).toContain('helper_mode')
  })

  it('rejects Linux packaging when the ECC runtime adapter is absent', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    await writeFile(join(appOutDir, 'ecos-studio'), 'binary-placeholder')

    await expect(
      afterPackLinuxSandbox({
        appOutDir,
        electronPlatformName: 'linux',
        packager: {
          appInfo: {
            productFilename: 'ecos-studio',
          },
          executableName: 'ecos-studio',
        },
      }),
    ).rejects.toThrow('Packaged ECC runtime adapter validation failed')
  })

  it('rejects Linux packaging when the ECC runtime adapter has no CLI', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    await writeFile(join(appOutDir, 'ecos-studio'), 'binary-placeholder')
    await writeInvalidRuntimeAdapter(appOutDir)
    await writePackagedAgent(appOutDir)

    await expect(
      afterPackLinuxSandbox({
        appOutDir,
        electronPlatformName: 'linux',
        packager: {
          appInfo: {
            productFilename: 'ecos-studio',
          },
          executableName: 'ecos-studio',
        },
      }),
    ).rejects.toThrow('Packaged ECC runtime adapter validation failed')
  })

  it('rejects Linux packaging when the ECC runtime adapter cannot start', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    await writeFile(join(appOutDir, 'ecos-studio'), 'binary-placeholder')
    await writeHelpOnlyRuntimeAdapter(appOutDir)
    await writePackagedAgent(appOutDir)

    await expect(
      afterPackLinuxSandbox({
        appOutDir,
        electronPlatformName: 'linux',
        packager: {
          appInfo: {
            productFilename: 'ecos-studio',
          },
          executableName: 'ecos-studio',
        },
      }),
    ).rejects.toThrow('Packaged ECC runtime adapter validation failed')
  })

  it('rejects Linux packaging when the bundled Agent provider is absent', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    await writeFile(join(appOutDir, 'ecos-studio'), 'binary-placeholder')
    await writeRuntimeAdapter(appOutDir)

    await expect(
      afterPackLinuxSandbox({
        appOutDir,
        electronPlatformName: 'linux',
        packager: {
          appInfo: { productFilename: 'ecos-studio' },
          executableName: 'ecos-studio',
        },
      }),
    ).rejects.toThrow('Packaged ECOS Agent validation failed')
  })

  it('skips non-Linux targets', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    const executablePath = join(appOutDir, 'ecos-studio')
    await writeFile(executablePath, 'binary-placeholder')

    await afterPackLinuxSandbox({
      appOutDir,
      electronPlatformName: 'darwin',
      packager: {
        appInfo: {
          productFilename: 'ecos-studio',
        },
        executableName: 'ecos-studio',
      },
    })

    expect(await readFile(executablePath, 'utf8')).toBe('binary-placeholder')
  })
})
