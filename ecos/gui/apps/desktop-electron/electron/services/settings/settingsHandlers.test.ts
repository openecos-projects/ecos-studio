import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSettingHandlers,
  ECC_VERSION_PROBE_TIMEOUT_MS,
  type SettingHandlerDependencies,
} from './settingsHandlers'
import { probeExecutableVersion } from './executableProbe'
import type { PdkInstallationSnapshot } from '@ecos-studio/shared'

const tempRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ecos-settings-'))
  tempRoots.push(root)
  return root
}

async function createVersionExecutable(
  root: string,
  name: string,
  version: string,
): Promise<string> {
  const binDir = join(root, 'bin')
  await mkdir(binDir, { recursive: true })
  const executablePath = join(binDir, name)
  await writeFile(executablePath, `#!/usr/bin/env bash\necho "${version}"\n`, {
    encoding: 'utf8',
    mode: 0o755,
  })
  return executablePath
}

function createDependencies(
  overrides: Partial<SettingHandlerDependencies> = {},
): SettingHandlerDependencies & {
  settings: Map<string, unknown>
} {
  const settings = new Map<string, unknown>()
  return {
    codexDependency: {
      clearBinPath: vi.fn(async () => ({})),
      setBinPath: vi.fn(async () => ({})),
    },
    pdkInventory: {
      listInstallations: vi.fn(async () => []),
    },
    restartEccRuntimes: vi.fn(async () => 'applied' as const),
    settingsStore: {
      delete: async (key: string) => {
        settings.delete(key)
      },
      get: async <T>(key: string): Promise<T | null> =>
        settings.has(key) ? (settings.get(key) as T) : null,
      set: async (key: string, value: unknown) => {
        settings.set(key, value)
      },
    },
    syncAgentCodexEnv: vi.fn(async () => undefined),
    settings,
    ...overrides,
  } as SettingHandlerDependencies & { settings: Map<string, unknown> }
}

describe('settings handlers', () => {
  it('validates a real ECC executable and reports its version', async () => {
    const root = await createTempRoot()
    const eccPath = await createVersionExecutable(root, 'ecc', 'ecc version 0.2.0')
    const dependencies = createDependencies()
    const handlers = createSettingHandlers(dependencies)

    await expect(handlers['runtime.eccPath'].validate(eccPath)).resolves.toEqual({
      displayInfo: 'ecc version 0.2.0',
      ok: true,
    })
  })

  it('rejects a nonexistent ECC path, a plain file, and probe failures', async () => {
    const root = await createTempRoot()
    const plainFile = join(root, 'not-executable.txt')
    await writeFile(plainFile, 'hello', 'utf8')
    const dependencies = createDependencies()
    const handlers = createSettingHandlers(dependencies)
    const validate = handlers['runtime.eccPath'].validate

    await expect(validate(join(root, 'missing-ecc'))).resolves.toMatchObject({
      ok: false,
    })
    await expect(validate(plainFile)).resolves.toMatchObject({ ok: false })
    await expect(validate('')).resolves.toMatchObject({ ok: false })
    expect(dependencies.settings.size).toBe(0)
  })

  it('persists an ECC path and restarts idle runtimes on apply', async () => {
    const root = await createTempRoot()
    const eccPath = await createVersionExecutable(root, 'ecc', 'ecc version 0.2.0')
    const dependencies = createDependencies()
    const handlers = createSettingHandlers(dependencies)
    const handler = handlers['runtime.eccPath']

    await handler.persist(eccPath)
    expect(dependencies.settings.get('runtime.eccPath')).toBe(eccPath)
    await expect(handler.apply(eccPath)).resolves.toBe('applied')
    expect(dependencies.restartEccRuntimes).toHaveBeenCalledTimes(1)

    await handler.clear()
    expect(dependencies.settings.has('runtime.eccPath')).toBe(false)
  })

  it('reports a pending apply when the runtime pool is busy', async () => {
    const dependencies = createDependencies({
      restartEccRuntimes: vi.fn(async () => 'pending' as const),
    })
    const handlers = createSettingHandlers(dependencies)

    await expect(handlers['runtime.eccSizerRoot'].apply('/tmp/sizer-root')).resolves.toBe(
      'pending',
    )
  })

  it('validates an ecc-sizer root with the sentinel file and an executable Sizer', async () => {
    const root = await createTempRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'sizer_os.tcl'), '# sizer', 'utf8')
    await mkdir(join(root, 'bin'), { recursive: true })
    const sizerPath = join(root, 'bin', 'Sizer')
    await writeFile(sizerPath, '#!/usr/bin/env bash\n', { mode: 0o755 })
    const handlers = createSettingHandlers(createDependencies())

    await expect(handlers['runtime.eccSizerRoot'].validate(root)).resolves.toEqual({
      displayInfo: root,
      ok: true,
    })
  })

  it('rejects an ecc-sizer root missing the sentinel or an executable Sizer', async () => {
    const handlers = createSettingHandlers(createDependencies())

    const missingSentinel = await createTempRoot()
    await mkdir(join(missingSentinel, 'bin'), { recursive: true })
    await writeFile(join(missingSentinel, 'bin', 'Sizer'), '#!/bin/sh\n', {
      mode: 0o755,
    })
    await expect(
      handlers['runtime.eccSizerRoot'].validate(missingSentinel),
    ).resolves.toMatchObject({ ok: false })

    const nonExecutableSizer = await createTempRoot()
    await mkdir(join(nonExecutableSizer, 'src'), { recursive: true })
    await writeFile(join(nonExecutableSizer, 'src', 'sizer_os.tcl'), '', 'utf8')
    await mkdir(join(nonExecutableSizer, 'bin'), { recursive: true })
    await writeFile(join(nonExecutableSizer, 'bin', 'Sizer'), '#!/bin/sh\n', {
      mode: 0o644,
    })
    await expect(
      handlers['runtime.eccSizerRoot'].validate(nonExecutableSizer),
    ).resolves.toMatchObject({ ok: false })

    const missingSizerBinary = await createTempRoot()
    await mkdir(join(missingSizerBinary, 'src'), { recursive: true })
    await writeFile(join(missingSizerBinary, 'src', 'sizer_os.tcl'), '', 'utf8')
    await expect(
      handlers['runtime.eccSizerRoot'].validate(missingSizerBinary),
    ).resolves.toMatchObject({ ok: false })

    await expect(
      handlers['runtime.eccSizerRoot'].validate(join(await createTempRoot(), 'nope')),
    ).resolves.toMatchObject({ ok: false })
  })

  it('delegates agent.codexBin persistence to CodexDependencyService only', async () => {
    const dependencies = createDependencies()
    const handlers = createSettingHandlers(dependencies)
    const root = await createTempRoot()
    const codexPath = await createVersionExecutable(root, 'codex', 'codex 1.2.3')
    const handler = handlers['agent.codexBin']

    await expect(handler.validate(codexPath)).resolves.toMatchObject({
      displayInfo: 'codex 1.2.3',
      ok: true,
    })

    await handler.persist(codexPath)
    expect(dependencies.codexDependency.setBinPath).toHaveBeenCalledWith(codexPath)
    expect(dependencies.settings.has('agent.codexBin')).toBe(false)

    await handler.apply(codexPath)
    expect(dependencies.syncAgentCodexEnv).toHaveBeenCalledTimes(1)

    await handler.clear()
    expect(dependencies.codexDependency.clearBinPath).toHaveBeenCalledTimes(1)
    expect(dependencies.syncAgentCodexEnv).toHaveBeenCalledTimes(2)
  })

  it('rejects an invalid codex path without persisting', async () => {
    const dependencies = createDependencies()
    const handlers = createSettingHandlers(dependencies)

    await expect(
      handlers['agent.codexBin'].validate(join(await createTempRoot(), 'missing')),
    ).resolves.toMatchObject({ ok: false })
    expect(dependencies.codexDependency.setBinPath).not.toHaveBeenCalled()

    // An executable that is not a Codex CLI (no codex in its version output)
    // must be rejected as well.
    const root = await createTempRoot()
    const impostor = await createVersionExecutable(root, 'codex', 'true 1.0')
    await expect(handlers['agent.codexBin'].validate(impostor)).resolves.toMatchObject({
      ok: false,
    })
    expect(dependencies.codexDependency.setBinPath).not.toHaveBeenCalled()
  })

  it('validates the default PDK installation id against the inventory', async () => {
    const installations: PdkInstallationSnapshot[] = [
      {
        familyId: 'sky130',
        id: 'sky130-1',
        ownership: 'managed',
        readiness: 'ready',
        reason: null,
        displayName: 'SkyWater 130nm',
        registrySha256: null,
        root: '/pdk/sky130',
        supportsEccDefaults: true,
        version: null,
      },
      {
        familyId: 'broken',
        id: 'broken-1',
        ownership: 'imported',
        readiness: 'invalid',
        reason: 'missing tech lef',
        displayName: 'Broken PDK',
        registrySha256: null,
        root: '/pdk/broken',
        supportsEccDefaults: false,
        version: null,
      },
    ]
    const dependencies = createDependencies({
      pdkInventory: {
        listInstallations: vi.fn(async () => installations),
      },
    })
    const handlers = createSettingHandlers(dependencies)
    const handler = handlers['pdk.defaultInstallationId']

    await expect(handler.validate('sky130-1')).resolves.toEqual({
      displayInfo: 'SkyWater 130nm',
      ok: true,
    })
    await expect(handler.validate('gone-id')).resolves.toMatchObject({ ok: false })
    // An unusable installation must not become the default.
    await expect(handler.validate('broken-1')).resolves.toMatchObject({ ok: false })

    await handler.persist('sky130-1')
    expect(dependencies.settings.get('pdk.defaultInstallationId')).toBe('sky130-1')

    // A padded id validates and persists trimmed so the wizard's exact-match
    // lookup succeeds.
    await expect(handler.validate(' sky130-1 ')).resolves.toMatchObject({ ok: true })
    await handler.persist(' sky130-1 ')
    expect(dependencies.settings.get('pdk.defaultInstallationId')).toBe('sky130-1')

    await expect(handler.apply('sky130-1')).resolves.toBe('applied')
    await handler.clear()
    expect(dependencies.settings.has('pdk.defaultInstallationId')).toBe(false)
  })

  it('persists an ECC path as the resolved absolute path so the sidecar can spawn it', async () => {
    const root = await createTempRoot()
    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    const executablePath = join(binDir, 'ecc')
    await writeFile(executablePath, '#!/usr/bin/env bash\necho "~ ecc"\n', {
      encoding: 'utf8',
      mode: 0o755,
    })

    const previousHome = process.env.HOME
    process.env.HOME = root
    try {
      const dependencies = createDependencies()
      const handlers = createSettingHandlers(dependencies)

      await expect(
        handlers['runtime.eccPath'].validate('~/bin/ecc'),
      ).resolves.toMatchObject({ ok: true })

      await handlers['runtime.eccPath'].persist('~/bin/ecc')
      // The stored value must be spawnable as-is (no literal `~`).
      expect(dependencies.settings.get('runtime.eccPath')).toBe(executablePath)
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = previousHome
      }
    }
  })

  it('validates and persists a tilde sizer root as the canonical absolute directory', async () => {
    const root = await createTempRoot()
    const sizerRoot = join(root, 'ecc-sizer')
    await mkdir(join(sizerRoot, 'src'), { recursive: true })
    await writeFile(join(sizerRoot, 'src', 'sizer_os.tcl'), '# sizer', 'utf8')
    await mkdir(join(sizerRoot, 'bin'), { recursive: true })
    await writeFile(join(sizerRoot, 'bin', 'Sizer'), '#!/usr/bin/env bash\n', {
      mode: 0o755,
    })

    const previousHome = process.env.HOME
    process.env.HOME = root
    try {
      const dependencies = createDependencies()
      const handlers = createSettingHandlers(dependencies)

      await expect(
        handlers['runtime.eccSizerRoot'].validate('~/ecc-sizer'),
      ).resolves.toMatchObject({ displayInfo: sizerRoot, ok: true })

      await handlers['runtime.eccSizerRoot'].persist('~/ecc-sizer')
      expect(dependencies.settings.get('runtime.eccSizerRoot')).toBe(sizerRoot)
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = previousHome
      }
    }
  })

  it('persists a relative ECC path resolved against the working directory', async () => {
    const root = await createTempRoot()
    const binDir = join(root, 'working-dir-bin')
    await mkdir(binDir, { recursive: true })
    const executablePath = join(binDir, 'ecc')
    await writeFile(executablePath, '#!/usr/bin/env bash\necho "relative ecc"\n', {
      encoding: 'utf8',
      mode: 0o755,
    })

    const previousCwd = process.cwd()
    process.chdir(root)
    try {
      const dependencies = createDependencies()
      const handlers = createSettingHandlers(dependencies)

      await expect(
        handlers['runtime.eccPath'].validate(join('working-dir-bin', 'ecc')),
      ).resolves.toMatchObject({ displayInfo: 'relative ecc', ok: true })

      await handlers['runtime.eccPath'].persist(join('working-dir-bin', 'ecc'))
      const stored = dependencies.settings.get('runtime.eccPath') as string
      expect(stored).toBe(executablePath)
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('keeps the version probe timeout at an internal constant', () => {
    expect(ECC_VERSION_PROBE_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('fails validation when the ECC version probe times out', async () => {
    const root = await createTempRoot()
    const eccPath = await createVersionExecutable(root, 'ecc', 'never prints')
    class HangingChild extends EventEmitter {
      kill = vi.fn((signal?: NodeJS.Signals) => {
        // A stubborn child ignores SIGTERM and only dies on SIGKILL.
        if (signal === 'SIGKILL') this.emit('close', null, 'SIGKILL')
      })
    }
    const child = new HangingChild()
    const spawn = vi.fn(() => child)

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const probe = probeExecutableVersion(
        eccPath,
        ['--version'],
        { timeoutMs: ECC_VERSION_PROBE_TIMEOUT_MS },
        spawn as never,
      )
      // The probe resolves the executable path with real filesystem I/O before
      // arming its timeout; wait for the spawn to happen before advancing.
      while (spawn.mock.calls.length === 0) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      await vi.advanceTimersByTimeAsync(ECC_VERSION_PROBE_TIMEOUT_MS + 1_000)
      await expect(probe).resolves.toMatchObject({
        error: expect.stringContaining('超时'),
        ok: false,
      })
      expect(child.kill).toHaveBeenCalledWith()
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})
