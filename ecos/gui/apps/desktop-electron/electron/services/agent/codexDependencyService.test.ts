import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CodexDependencyService,
  type CodexDependencySettingsStore,
} from './codexDependencyService'
import { DESKTOP_CODEX_BIN_SETTING_KEY } from '@ecos-studio/shared'

class MemorySettingsStore implements CodexDependencySettingsStore {
  private readonly values = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | null> {
    if (!this.values.has(key)) return null
    return this.values.get(key) as T
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value)
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  unref = vi.fn()
  kill = vi.fn()
}

describe('CodexDependencyService', () => {
  const tempRoots: string[] = []

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  async function createRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ecos-codex-dep-'))
    tempRoots.push(root)
    return root
  }

  it('reports missing when no codex binary is available', async () => {
    const root = await createRoot()
    const service = new CodexDependencyService({
      env: { PATH: join(root, 'empty-bin') },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      settingsStore: new MemorySettingsStore(),
      spawn: vi.fn() as never,
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'missing',
      platformSupportsInstall: true,
    })
  })

  it('prefers settings path over PATH', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    const settingsBin = join(binDir, 'settings-codex')
    const pathBin = join(binDir, 'codex')
    await writeFile(settingsBin, '#!/bin/sh\necho settings-codex 1.0\n')
    await writeFile(pathBin, '#!/bin/sh\necho path-codex 1.0\n')
    await chmod(settingsBin, 0o755)
    await chmod(pathBin, 0o755)

    const settingsStore = new MemorySettingsStore()
    await settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, settingsBin)

    const spawn = vi.fn((command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(() => {
        if (args[0] === '--version') {
          child.stdout.emit(
            'data',
            `${command.includes('settings') ? 'settings' : 'path'} 1.0\n`,
          )
          child.emit('close', 0)
          return
        }
        if (args[0] === 'login' && args[1] === 'status') {
          child.stdout.emit('data', 'Logged in\n')
          child.emit('close', 0)
          return
        }
        child.emit('close', 1)
      })
      return child as never
    })

    const service = new CodexDependencyService({
      env: { PATH: binDir, HOME: root },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'ready',
      binPath: settingsBin,
      authState: 'authenticated',
    })
  })

  it('rejects install on non-linux platforms', async () => {
    const root = await createRoot()
    const service = new CodexDependencyService({
      env: { PATH: '' },
      installRoot: join(root, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      settingsStore: new MemorySettingsStore(),
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      platformSupportsInstall: false,
      state: 'missing',
    })
    await expect(service.install()).rejects.toThrow('暂不支持一键安装')
  })

  it('installs from the first successful download URL and persists settings', async () => {
    const root = await createRoot()
    const settingsStore = new MemorySettingsStore()
    const archiveBytes = await buildTinyGzipTarWithCodex()

    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('releases.openai.com')) {
        return new Response('missing', { status: 404 })
      }
      return new Response(archiveBytes.buffer as ArrayBuffer, {
        status: 200,
        headers: { 'content-length': String(archiveBytes.byteLength) },
      })
    })

    const spawn = vi.fn((command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(async () => {
        if (command === 'tar') {
          const destFlag = args.indexOf('-C')
          const destination = destFlag >= 0 ? args[destFlag + 1] : ''
          await writeFile(
            join(destination, 'codex-x86_64-unknown-linux-musl'),
            '#!/bin/sh\necho 0.1\n',
          )
          await chmod(join(destination, 'codex-x86_64-unknown-linux-musl'), 0o755)
          child.emit('close', 0)
          return
        }
        if (args[0] === '--version') {
          child.stdout.emit('data', 'codex-cli 0.1.0\n')
          child.emit('close', 0)
          return
        }
        if (args[0] === 'login' && args[1] === 'status') {
          child.stderr.emit('data', 'Not logged in\n')
          child.emit('close', 1)
          return
        }
        child.emit('close', 0)
      })
      return child as never
    })

    const service = new CodexDependencyService({
      env: { PATH: '', HOME: root },
      fetchImpl: fetchImpl as never,
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    const status = await service.install()
    expect(status.state).toBe('installed_needs_login')
    expect(status.binPath).toBe(join(root, 'managed', 'bin', 'codex'))
    await expect(settingsStore.get<string>(DESKTOP_CODEX_BIN_SETTING_KEY)).resolves.toBe(
      join(root, 'managed', 'bin', 'codex'),
    )
  })

  it('setBinPath validates executability before saving', async () => {
    const root = await createRoot()
    const settingsStore = new MemorySettingsStore()
    const service = new CodexDependencyService({
      env: { PATH: '', HOME: root },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      settingsStore,
      homedir: () => root,
    })

    await expect(service.setBinPath(join(root, 'missing'))).rejects.toThrow(
      '不是可执行的 Codex CLI',
    )
  })
})

async function buildTinyGzipTarWithCodex(): Promise<Uint8Array> {
  // The service shells out to `tar -xf`; content only needs to be a non-empty buffer
  // for the download path. Extraction is stubbed in the spawn fake.
  return Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff])
}
