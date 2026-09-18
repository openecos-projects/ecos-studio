import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, writeFile, chmod, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CodexDependencyService,
  type CodexDependencySettingsStore,
} from './codexDependencyService'
import { ModelProfileService, modelProfileApiKeySettingKey } from './modelProfileService'
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

  async delete(key: string): Promise<void> {
    this.values.delete(key)
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

  function createProfileService(
    settingsStore: MemorySettingsStore,
    root: string,
  ): ModelProfileService {
    return new ModelProfileService({
      configRoot: join(root, 'profiles'),
      settingsStore,
      homedir: () => root,
    })
  }

  it('reports missing when no codex binary is available', async () => {
    const root = await createRoot()
    const settingsStore = new MemorySettingsStore()
    const service = new CodexDependencyService({
      env: { PATH: join(root, 'empty-bin') },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      profileService: createProfileService(settingsStore, root),
      settingsStore,
      spawn: vi.fn() as never,
      homedir: () => root,
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'missing',
      platformSupportsInstall: true,
    })
    await expect(service.resolveEnvironmentForAgent()).resolves.toStrictEqual({})
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
        child.emit('close', 1)
      })
      return child as never
    })

    const service = new CodexDependencyService({
      env: { PATH: binDir, HOME: root },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      profileService: createProfileService(settingsStore, root),
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'needs_api_key',
      binPath: settingsBin,
      authState: 'unauthenticated',
    })
  })

  it('finds Codex in well-known user install directories before PATH', async () => {
    const root = await createRoot()
    const binDir = join(root, '.nvm', 'versions', 'node', 'v22.1.0', 'bin')
    const codexBin = join(binDir, 'codex')
    await mkdir(binDir, { recursive: true })
    await writeFile(codexBin, '#!/bin/sh\necho codex-cli 1.0.0\n')
    await chmod(codexBin, 0o755)

    const spawn = vi.fn((command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(() => {
        if (args[0] === '--version') {
          child.stdout.emit('data', 'codex-cli 1.0.0\n')
          child.emit('close', 0)
          return
        }
        if (command === codexBin && args[0] === 'login' && args[1] === 'status') {
          child.stdout.emit('data', 'Logged in\n')
          child.emit('close', 0)
          return
        }
        child.emit('close', 1)
      })
      return child as never
    })

    const settingsStore = new MemorySettingsStore()
    const service = new CodexDependencyService({
      env: { PATH: join(root, 'empty-bin') },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      profileService: createProfileService(settingsStore, root),
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'needs_api_key',
      binPath: codexBin,
      authState: 'unauthenticated',
    })
  })

  it('rejects install on non-linux platforms', async () => {
    const root = await createRoot()
    const settingsStore = new MemorySettingsStore()
    const service = new CodexDependencyService({
      env: { PATH: '' },
      installRoot: join(root, 'managed'),
      platform: 'darwin',
      arch: 'arm64',
      profileService: createProfileService(settingsStore, root),
      settingsStore,
      homedir: () => root,
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
      profileService: createProfileService(settingsStore, root),
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    const status = await service.install()
    expect(status.state).toBe('needs_api_key')
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
      profileService: createProfileService(settingsStore, root),
      settingsStore,
      homedir: () => root,
    })

    await expect(service.setBinPath(join(root, 'missing'))).rejects.toThrow(
      '不是可执行的 Codex CLI',
    )
  })

  it('uses the selected Codex directory for NVM Node script execution', async () => {
    const root = await createRoot()
    const binDir = join(root, '.nvm', 'versions', 'node', 'v20', 'bin')
    const codexBin = join(binDir, 'codex')
    await mkdir(binDir, { recursive: true })
    await writeFile(codexBin, '#!/usr/bin/env node\n')
    await chmod(codexBin, 0o755)

    const spawn = vi.fn(
      (_command: string, args: string[], _options: { env?: NodeJS.ProcessEnv }) => {
        const child = new FakeChild()
        queueMicrotask(() => {
          if (args[0] === '--version') {
            child.stdout.emit('data', 'codex-cli 0.1.0\n')
            child.emit('close', 0)
            return
          }
          child.emit('close', 0)
        })
        return child as never
      },
    )
    const settingsStore = new MemorySettingsStore()
    const service = new CodexDependencyService({
      env: { PATH: '/usr/bin:/bin', HOME: root },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      profileService: createProfileService(settingsStore, root),
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    await expect(service.setBinPath(codexBin)).resolves.toMatchObject({
      state: 'needs_api_key',
    })
    await expect(service.resolveEnvironmentForAgent()).resolves.toEqual({
      ECOS_AGENT_CODEX_BIN: codexBin,
      ECOS_AGENT_CODEX_PROFILE_REVISION: expect.any(String),
      CODEX_HOME: undefined,
      ZAI_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      PATH: `${binDir}:/usr/bin:/bin`,
    })
    expect(spawn.mock.calls[0]?.[2]?.env?.PATH).toBe(`${binDir}:/usr/bin:/bin`)
  })

  it('ignores the settings codex binary override for managed profiles', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    const settingsBin = join(binDir, 'wrapper-codex')
    const pathBin = join(binDir, 'codex')
    await writeFile(settingsBin, '#!/bin/sh\necho wrapper 1.0\n')
    await writeFile(pathBin, '#!/bin/sh\necho path 1.0\n')
    await chmod(settingsBin, 0o755)
    await chmod(pathBin, 0o755)

    const spawn = vi.fn((_command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(() => {
        if (args[0] === '--version') {
          child.stdout.emit('data', 'codex-cli 0.1.0\n')
        }
        child.emit('close', 0)
      })
      return child as never
    })
    const settingsStore = new MemorySettingsStore()
    await settingsStore.set(DESKTOP_CODEX_BIN_SETTING_KEY, settingsBin)
    const profileService = createProfileService(settingsStore, root)
    const service = new CodexDependencyService({
      env: { PATH: binDir, HOME: root },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      profileService,
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    await profileService.select('glm')
    const status = await service.getStatus()
    expect(status.binPath).toBe(pathBin)
    await expect(service.resolveEnvironmentForAgent()).resolves.toMatchObject({
      ECOS_AGENT_CODEX_BIN: pathBin,
      CODEX_HOME: join(root, 'profiles', 'glm'),
    })
  })

  it('reports needs-key status for a managed profile', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    const codexBin = join(binDir, 'codex')
    await writeFile(codexBin, '#!/bin/sh\necho codex 1.0\n')
    await chmod(codexBin, 0o755)

    const spawn = vi.fn((command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(() => {
        if (args[0] === '--version') {
          child.stdout.emit('data', 'codex-cli 0.1.0\n')
          child.emit('close', 0)
          return
        }
        child.emit('close', 1)
      })
      return child as never
    })
    const settingsStore = new MemorySettingsStore()
    const profileService = createProfileService(settingsStore, root)
    const service = new CodexDependencyService({
      env: { PATH: binDir, HOME: root },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      profileService,
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    await profileService.select('glm')
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'needs_api_key',
      authState: 'unauthenticated',
      activeProfileId: 'glm',
    })
    expect(spawn.mock.calls.some((call) => call[1]?.[0] === 'login')).toBe(false)

    await expect(service.resolveEnvironmentForAgent()).resolves.toEqual({
      ECOS_AGENT_CODEX_BIN: codexBin,
      ECOS_AGENT_CODEX_PROFILE_REVISION: expect.any(String),
      CODEX_HOME: join(root, 'profiles', 'glm'),
      ZAI_API_KEY: undefined,
      PATH: binDir,
    })
  })

  it.each([
    {
      profileId: 'glm',
      envKey: 'ZAI_API_KEY',
      defaultModel: 'glm-5.3-flash',
      modelSlugs: ['glm-5.3', 'glm-5.3-flash'],
    },
    {
      profileId: 'sub2api',
      envKey: 'SUB2API_API_KEY',
      defaultModel: 'kimi-for-coding',
      modelSlugs: ['kimi-for-coding'],
    },
  ])(
    '$profileId stores the key, writes the managed config home, and reports ready',
    async ({ profileId, envKey, defaultModel, modelSlugs }) => {
      const root = await createRoot()
      const binDir = join(root, 'bin')
      await mkdir(binDir, { recursive: true })
      const codexBin = join(binDir, 'codex')
      await writeFile(codexBin, '#!/bin/sh\necho codex 1.0\n')
      await chmod(codexBin, 0o755)

      const spawn = vi.fn((_command: string, args: string[]) => {
        const child = new FakeChild()
        queueMicrotask(() => {
          if (args[0] === '--version') {
            child.stdout.emit('data', 'codex-cli 0.1.0\n')
          }
          child.emit('close', 0)
        })
        return child as never
      })
      const settingsStore = new MemorySettingsStore()
      const profileService = createProfileService(settingsStore, root)
      const profileConfigRoot = join(root, 'profiles', profileId)
      const service = new CodexDependencyService({
        env: { PATH: binDir, HOME: root },
        installRoot: join(root, 'managed'),
        platform: 'linux',
        arch: 'x64',
        profileService,
        settingsStore,
        spawn: spawn as never,
        homedir: () => root,
      })

      await profileService.select(profileId)
      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'needs_api_key',
        activeProfileId: profileId,
        apiKeyConfigured: false,
      })
      await profileService.setApiKey(profileId, ' test-key ')
      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'ready',
        authState: 'authenticated',
        activeProfileId: profileId,
      })
      await expect(
        settingsStore.get<string>(modelProfileApiKeySettingKey(profileId)),
      ).resolves.toBe('test-key')
      const configToml = await readFile(join(profileConfigRoot, 'config.toml'), 'utf8')
      expect(configToml).toContain(`model = "${defaultModel}"`)
      expect(configToml).toContain(`env_key = "${envKey}"`)
      expect(configToml).not.toContain('test-key')
      const modelsJson = JSON.parse(
        await readFile(join(profileConfigRoot, 'models.json'), 'utf8'),
      )
      expect(modelsJson.models.map((model: { slug: string }) => model.slug)).toEqual(
        modelSlugs,
      )
      await expect(service.resolveEnvironmentForAgent()).resolves.toEqual({
        ECOS_AGENT_CODEX_BIN: codexBin,
        ECOS_AGENT_CODEX_PROFILE_REVISION: expect.any(String),
        CODEX_HOME: profileConfigRoot,
        [envKey]: 'test-key',
        PATH: binDir,
      })
    },
  )

  it.each([
    ['glm', 'ZAI_API_KEY'],
    ['sub2api', 'SUB2API_API_KEY'],
  ])(
    'switching from %s to codex clears its profile overrides',
    async (profileId, envKey) => {
      const root = await createRoot()
      const binDir = join(root, 'bin')
      await mkdir(binDir, { recursive: true })
      const codexBin = join(binDir, 'codex')
      await writeFile(codexBin, '#!/bin/sh\necho codex 1.0\n')
      await chmod(codexBin, 0o755)

      const spawn = vi.fn((_command: string, args: string[]) => {
        const child = new FakeChild()
        queueMicrotask(() => {
          if (args[0] === '--version') {
            child.stdout.emit('data', 'codex-cli 0.1.0\n')
          }
          child.emit('close', 0)
        })
        return child as never
      })
      const settingsStore = new MemorySettingsStore()
      await settingsStore.set(modelProfileApiKeySettingKey(profileId), 'test-key')
      const profileService = createProfileService(settingsStore, root)
      const service = new CodexDependencyService({
        env: { PATH: binDir, HOME: root },
        installRoot: join(root, 'managed'),
        platform: 'linux',
        arch: 'x64',
        profileService,
        settingsStore,
        spawn: spawn as never,
        homedir: () => root,
      })

      await profileService.select(profileId)
      await expect(service.resolveEnvironmentForAgent()).resolves.toMatchObject({
        CODEX_HOME: join(root, 'profiles', profileId),
        [envKey]: 'test-key',
      })
      await profileService.select('codex')
      await expect(service.resolveEnvironmentForAgent()).resolves.toEqual({
        ECOS_AGENT_CODEX_BIN: codexBin,
        ECOS_AGENT_CODEX_PROFILE_REVISION: expect.any(String),
        CODEX_HOME: undefined,
        ZAI_API_KEY: undefined,
        SUB2API_API_KEY: undefined,
        OPENAI_API_KEY: undefined,
        PATH: binDir,
      })
    },
  )

  it('changes the environment revision when the active preset is edited or restored', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    const codexBin = join(binDir, 'codex')
    await writeFile(codexBin, '#!/bin/sh\n')
    await chmod(codexBin, 0o755)
    const settingsStore = new MemorySettingsStore()
    const profileService = createProfileService(settingsStore, root)
    const service = new CodexDependencyService({
      env: { PATH: binDir },
      installRoot: join(root, 'managed'),
      profileService,
      settingsStore,
      spawn: vi.fn() as never,
    })
    await profileService.select('deepseek')
    const before = await service.resolveEnvironmentForAgent()
    await expect(service.resolveEnvironmentForAgent()).resolves.toEqual(before)
    const original = await profileService.activeProfile()
    await profileService.upsert({ ...original, defaultModel: original.models[1]!.slug })
    const changed = await service.resolveEnvironmentForAgent()
    expect(changed.CODEX_HOME).toBe(before.CODEX_HOME)
    expect(changed.ECOS_AGENT_CODEX_PROFILE_REVISION).not.toBe(
      before.ECOS_AGENT_CODEX_PROFILE_REVISION,
    )
    await profileService.delete('deepseek')
    await expect(service.resolveEnvironmentForAgent()).resolves.toEqual(before)
  })

  it('makes the codex profile ready via API key without any login check', async () => {
    const root = await createRoot()
    const binDir = join(root, 'bin')
    await mkdir(binDir, { recursive: true })
    const codexBin = join(binDir, 'codex')
    await writeFile(codexBin, '#!/bin/sh\necho codex 1.0\n')
    await chmod(codexBin, 0o755)

    const spawn = vi.fn((_command: string, args: string[]) => {
      const child = new FakeChild()
      queueMicrotask(() => {
        if (args[0] === '--version') {
          child.stdout.emit('data', 'codex-cli 0.1.0\n')
        }
        child.emit('close', 0)
      })
      return child as never
    })
    const settingsStore = new MemorySettingsStore()
    const profileService = createProfileService(settingsStore, root)
    const service = new CodexDependencyService({
      env: { PATH: binDir, HOME: root },
      installRoot: join(root, 'managed'),
      platform: 'linux',
      arch: 'x64',
      profileService,
      settingsStore,
      spawn: spawn as never,
      homedir: () => root,
    })

    await profileService.setApiKey('codex', ' sk-test ')
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'ready',
      authState: 'authenticated',
      apiKeyConfigured: true,
      activeProfileId: 'codex',
    })
    await expect(
      settingsStore.get<string>(modelProfileApiKeySettingKey('codex')),
    ).resolves.toBe('sk-test')
    expect(spawn.mock.calls.some((call) => call[1]?.[0] === 'login')).toBe(false)
    await expect(service.resolveEnvironmentForAgent()).resolves.toMatchObject({
      ECOS_AGENT_CODEX_BIN: codexBin,
      OPENAI_API_KEY: 'sk-test',
      CODEX_HOME: undefined,
      ZAI_API_KEY: undefined,
    })
  })
})

async function buildTinyGzipTarWithCodex(): Promise<Uint8Array> {
  // The service shells out to `tar -xf`; content only needs to be a non-empty buffer
  // for the download path. Extraction is stubbed in the spawn fake.
  return Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff])
}
