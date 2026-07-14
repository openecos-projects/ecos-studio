import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import afterPackLinuxSandbox from './after-pack-linux-sandbox.mjs'

const tempDirs: string[] = []

async function writeRpcCapableEcc(appOutDir: string): Promise<void> {
  const binariesDir = join(appOutDir, 'resources', 'binaries')
  const eccPath = join(binariesDir, 'ecc')
  await mkdir(binariesDir, { recursive: true })
  await writeFile(eccPath, '#!/bin/sh\nexit 0\n')
  await chmod(eccPath, 0o755)
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
    await writeRpcCapableEcc(appOutDir)

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

  it('rejects Linux packaging when the ECC RPC sidecar is absent', async () => {
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
    ).rejects.toThrow('Packaged ECC RPC sidecar validation failed')
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
