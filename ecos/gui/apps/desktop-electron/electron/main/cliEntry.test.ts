import { spawn as spawnChild, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  applyHeadlessDisplayHint,
  parseCliInvocation,
  runCliCommand,
  type CliRunDependencies,
} from './cliEntry'

function createChildDouble(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess & {
    kill: (signal?: NodeJS.Signals | number) => boolean
  }
  child.kill = vi.fn()
  return child
}

function createDependencies(
  overrides: Partial<CliRunDependencies> = {},
): CliRunDependencies {
  return {
    env: { PATH: '/usr/bin' },
    platform: 'linux',
    resolveExecutable: vi.fn(() => '/opt/ecc-runtime/current/binaries/ecc'),
    buildRuntimeEnv: vi.fn(
      async () =>
        ({ PATH: '/opt/ecc-runtime/current/binaries:/usr/bin' }) as NodeJS.ProcessEnv,
    ),
    spawn: vi.fn(() => createChildDouble()) as unknown as typeof spawnChild,
    ...overrides,
  }
}

function createSpawnMock(child: ChildProcess): typeof spawnChild {
  return vi.fn(() => child) as unknown as typeof spawnChild
}

describe('parseCliInvocation', () => {
  it('parses --cli as the first user argument and forwards args verbatim', () => {
    expect(
      parseCliInvocation(['/opt/AppImage', '--cli', 'ecc', 'run', '--project', 'gcd']),
    ).toEqual({ command: 'ecc', args: ['run', '--project', 'gcd'] })
  })

  it('skips the electron default-app entry script prefix', () => {
    expect(
      parseCliInvocation([
        '/usr/bin/electron',
        '/opt/app/index.js',
        '--cli',
        'ecc',
        '--version',
      ]),
    ).toEqual({ command: 'ecc', args: ['--version'] })
    expect(parseCliInvocation(['/usr/bin/electron', '.', '--cli', 'ecc'])).toEqual({
      command: 'ecc',
      args: [],
    })
  })

  it('returns null for GUI launches, workspace paths, and non-entry prefixes', () => {
    expect(parseCliInvocation(['/opt/AppImage'])).toBeNull()
    expect(parseCliInvocation(['/opt/AppImage', '--project', 'gcd'])).toBeNull()
    // A workspace path at argv[1] is not a default-app prefix, so a later
    // --cli belongs to some other tool.
    expect(
      parseCliInvocation(['/opt/AppImage', '/home/user/proj', '--cli', 'ecc']),
    ).toBeNull()
  })

  it('treats bare --cli as an invalid empty command for usage handling', () => {
    expect(parseCliInvocation(['/opt/AppImage', '--cli'])).toEqual({
      command: '',
      args: [],
    })
  })
})

describe('applyHeadlessDisplayHint', () => {
  it('applies the headless hint only when no display variables exist', () => {
    const headless: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    expect(applyHeadlessDisplayHint(headless)).toBe(true)
    expect(headless.ELECTRON_OZONE_PLATFORM_HINT).toBe('headless')

    const withDisplay: NodeJS.ProcessEnv = { DISPLAY: ':0' }
    expect(applyHeadlessDisplayHint(withDisplay)).toBe(false)
    expect(withDisplay.ELECTRON_OZONE_PLATFORM_HINT).toBeUndefined()

    const withWayland: NodeJS.ProcessEnv = { WAYLAND_DISPLAY: 'wayland-0' }
    expect(applyHeadlessDisplayHint(withWayland)).toBe(false)

    const withExistingHint: NodeJS.ProcessEnv = {
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
    }
    expect(applyHeadlessDisplayHint(withExistingHint)).toBe(false)
    expect(withExistingHint.ELECTRON_OZONE_PLATFORM_HINT).toBe('x11')
  })
})

describe('runCliCommand', () => {
  it('prints usage and exits non-zero for unsupported commands', async () => {
    const log = vi.fn()
    const usageSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dependencies = createDependencies({ log })

    const code = await runCliCommand({ command: 'fe', args: [] }, dependencies)

    expect(code).toBe(2)
    expect(dependencies.resolveExecutable).not.toHaveBeenCalled()
    usageSpy.mockRestore()
  })

  it('exits non-zero when the ECC executable cannot be resolved', async () => {
    const log = vi.fn()
    const dependencies = createDependencies({
      resolveExecutable: vi.fn(() => null),
      log,
    })

    const code = await runCliCommand(
      { command: 'ecc', args: ['--version'] },
      dependencies,
    )

    expect(code).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not ready'))
    expect(dependencies.buildRuntimeEnv).not.toHaveBeenCalled()
  })

  it('spawns the resolved executable with forwarded args and the runtime env', async () => {
    const child = createChildDouble()
    const spawn = createSpawnMock(child)
    const dependencies = createDependencies({ spawn })

    const promise = runCliCommand(
      { command: 'ecc', args: ['run', '--project', 'gcd'] },
      dependencies,
    )
    queueMicrotask(() => child.emit('close', 0, null))
    await expect(promise).resolves.toBe(0)
    expect(spawn).toHaveBeenCalledWith(
      '/opt/ecc-runtime/current/binaries/ecc',
      ['run', '--project', 'gcd'],
      expect.objectContaining({
        stdio: 'inherit',
        env: { PATH: '/opt/ecc-runtime/current/binaries:/usr/bin' },
      }),
    )
  })

  it('maps a fatal signal to 128+n and forwards SIGINT to the child', async () => {
    const child = createChildDouble()
    const spawn = createSpawnMock(child)
    const dependencies = createDependencies({ spawn })

    const promise = runCliCommand({ command: 'ecc', args: ['run'] }, dependencies)
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.emit('SIGINT', 'SIGINT')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    child.emit('close', null, 'SIGTERM')
    await expect(promise).resolves.toBe(128 + 15)
  })

  it('resolves non-zero when the child cannot be spawned', async () => {
    const log = vi.fn()
    const child = createChildDouble()
    const spawn = createSpawnMock(child)
    const dependencies = createDependencies({ log, spawn })

    const promise = runCliCommand({ command: 'ecc', args: [] }, dependencies)
    await new Promise((resolve) => setTimeout(resolve, 0))
    child.emit('error', new Error('ENOENT'))
    await expect(promise).resolves.toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ENOENT'))
  })
})
