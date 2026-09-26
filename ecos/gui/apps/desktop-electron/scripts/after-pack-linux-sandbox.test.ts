import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import afterPackLinuxSandbox, {
  packagedAgentBinaryName,
} from './after-pack-linux-sandbox.mjs'

const tempDirs: string[] = []

async function writePackagedAgent(appOutDir: string, agentDir?: string): Promise<void> {
  const dir = agentDir ?? join(appOutDir, 'resources', 'agent')
  const agentPath = join(dir, 'ecos-agent')
  await mkdir(dir, { recursive: true })
  await writeFile(
    agentPath,
    '#!/bin/sh\n[ "$1" = --version ] || exit 64\nprintf "ecos-agent 0.1.0\\n"\n',
  )
  await writeFile(
    join(dir, 'agent-provider.json'),
    JSON.stringify({
      command: './ecos-agent',
      protocolVersion: 2,
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
  it('wraps the Linux executable to disable the sandbox without shifting user arguments', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    const executablePath = join(appOutDir, 'ecos-studio')
    await writeFile(executablePath, 'binary-placeholder')
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
    // The fallback must disable the sandbox through the environment: any
    // switch injected before "$@" would occupy argv[1] and break the
    // --cli pass-through dispatch in the Electron main process.
    expect(wrapperScript).toContain('ELECTRON_DISABLE_SANDBOX=1')
    expect(wrapperScript).not.toContain('"$BINARY" --')
    expect(wrapperScript).toContain('exec "$BINARY" "$@"')
    expect(wrapperScript).toContain('helper_mode')
  })

  it('accepts Linux packaging without an embedded ECC (slim build)', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    await writeFile(join(appOutDir, 'ecos-studio'), 'binary-placeholder')
    await writePackagedAgent(appOutDir)

    // ECC is acquired from the registry on first run, so its absence must
    // not fail packaging.
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
    ).resolves.toBeUndefined()
  })

  it('rejects Linux packaging when the bundled Agent provider is absent', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    await writeFile(join(appOutDir, 'ecos-studio'), 'binary-placeholder')

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

  it('skips the Linux sandbox wrapper on non-Linux targets', async () => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'ecos-after-pack-'))
    tempDirs.push(appOutDir)
    const executablePath = join(appOutDir, 'ecos-studio')
    await writeFile(executablePath, 'binary-placeholder')
    // On macOS, agent lives inside the .app bundle at
    // <appOutDir>/<productFilename>.app/Contents/Resources/agent/
    const macAgentDir = join(
      appOutDir,
      'ecos-studio.app',
      'Contents',
      'Resources',
      'agent',
    )
    await writePackagedAgent(appOutDir, macAgentDir)

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

    // Agent validation runs on all platforms, but the sandbox wrapper
    // is only applied on Linux. The binary must remain untouched.
    expect(await readFile(executablePath, 'utf8')).toBe('binary-placeholder')
  })

  it('uses the target platform when resolving the packaged Agent binary', () => {
    expect(packagedAgentBinaryName('win32')).toBe('ecos-agent.exe')
    expect(packagedAgentBinaryName('darwin')).toBe('ecos-agent')
    expect(packagedAgentBinaryName('linux')).toBe('ecos-agent')
  })
})
