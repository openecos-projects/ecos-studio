import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopModelProfile } from '@ecos-studio/shared'
import { ModelProfileService, modelProfileApiKeySettingKey } from './modelProfileService'
import { BUILTIN_MODEL_PROFILES } from './profileConfigHome'
import * as profileConfigHome from './profileConfigHome'
import type { CodexDependencySettingsStore } from './codexDependencyService'

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

const BUILTIN_IDS = ['codex', 'glm', 'kimi', 'deepseek']
const NO_KEYS = {
  codex: false,
  glm: false,
  kimi: false,
  deepseek: false,
}

function customProfile(
  overrides: Partial<DesktopModelProfile> = {},
): DesktopModelProfile {
  return {
    id: 'myendpoint',
    name: 'My Endpoint',
    baseUrl: 'https://llm.example.com/v1',
    wireApi: 'responses',
    envKey: 'MY_API_KEY',
    models: [{ slug: 'my-model', displayName: 'My Model', contextWindow: 256_000 }],
    defaultModel: 'my-model',
    builtIn: false,
    ...overrides,
  }
}

async function createService(settingsStore = new MemorySettingsStore()) {
  const configRoot = await mkdtemp(join(tmpdir(), 'ecos-profiles-'))
  const service = new ModelProfileService({ configRoot, settingsStore })
  return { configRoot, service, settingsStore }
}

describe('ModelProfileService', () => {
  it('lists built-in profiles with codex active by default', async () => {
    const { service } = await createService()
    const state = await service.list()
    expect(state.activeProfileId).toBe('codex')
    expect(state.profiles.map((profile) => profile.id)).toEqual(BUILTIN_IDS)
    expect(state.apiKeyConfigured).toEqual(NO_KEYS)
  })

  it('migrates legacy settings keys once and deletes them', async () => {
    const settingsStore = new MemorySettingsStore()
    await settingsStore.set('agent.modelSource', 'glm')
    await settingsStore.set('agent.glmApiKey', ' glm-key ')
    await settingsStore.set('agent.openaiApiKey', 'sk-old')
    const { service } = await createService(settingsStore)

    const state = await service.list()
    expect(state.activeProfileId).toBe('glm')
    expect(state.apiKeyConfigured).toEqual({ ...NO_KEYS, codex: true, glm: true })
    await expect(settingsStore.get('agent.modelSource')).resolves.toBeNull()
    await expect(settingsStore.get('agent.glmApiKey')).resolves.toBeNull()
    await expect(settingsStore.get('agent.openaiApiKey')).resolves.toBeNull()
    await expect(settingsStore.get(modelProfileApiKeySettingKey('glm'))).resolves.toBe(
      'glm-key',
    )
    await expect(settingsStore.get(modelProfileApiKeySettingKey('codex'))).resolves.toBe(
      'sk-old',
    )
  })

  it('upserts, selects, and deletes custom profiles', async () => {
    const { configRoot, service } = await createService()

    let state = await service.upsert(customProfile())
    expect(state.profiles.map((profile) => profile.id)).toEqual([
      ...BUILTIN_IDS,
      'myendpoint',
    ])

    state = await service.select('myendpoint')
    expect(state.activeProfileId).toBe('myendpoint')
    const configToml = await readFile(
      join(configRoot, 'myendpoint', 'config.toml'),
      'utf8',
    )
    expect(configToml).toContain('model = "my-model"')
    expect(configToml).toContain('wire_api = "responses"')
    expect(configToml).toContain('env_key = "MY_API_KEY"')

    state = await service.delete('myendpoint')
    expect(state.profiles.map((profile) => profile.id)).toEqual(BUILTIN_IDS)
    expect(state.activeProfileId).toBe('codex')
  })

  it('rejects invalid profiles at the backend boundary', async () => {
    const { service } = await createService()
    await expect(service.delete('unknown')).rejects.toThrow('未知的模型配置')
    await expect(service.upsert(customProfile({ id: '../escape' }))).rejects.toThrow('id')
    await expect(service.upsert(customProfile({ wireApi: 'chat' }))).rejects.toThrow(
      'Codex CLI',
    )
    await expect(service.upsert(customProfile({ name: 'bad\nname' }))).rejects.toThrow(
      '名称',
    )
    await expect(
      service.upsert(customProfile({ baseUrl: 'ftp://example.com' })),
    ).rejects.toThrow('Base URL')
    await expect(service.upsert(customProfile({ defaultModel: 'nope' }))).rejects.toThrow(
      '默认模型',
    )
  })

  it('persists built-in overrides, regenerates their config, and keeps their keys', async () => {
    const { configRoot, service, settingsStore } = await createService()
    await service.setApiKey('deepseek', 'saved-key')
    const original = BUILTIN_MODEL_PROFILES.find((profile) => profile.id === 'deepseek')!
    const edited = {
      ...original,
      name: 'My DeepSeek',
      baseUrl: 'https://gateway.example.com/v1',
      defaultModel: original.models[1]!.slug,
    }
    const saved = await service.upsert(edited)
    expect(saved.profiles.filter((profile) => profile.id === 'deepseek')).toEqual([
      edited,
    ])
    expect(saved.apiKeyConfigured.deepseek).toBe(true)
    const reopened = new ModelProfileService({ configRoot, settingsStore })
    expect(await reopened.activeProfile()).toEqual(edited)
    const toml = await readFile(join(configRoot, 'deepseek', 'config.toml'), 'utf8')
    expect(toml).toContain('base_url = "https://gateway.example.com/v1"')
    expect(toml).toContain(`model = "${edited.defaultModel}"`)
    expect(toml).not.toContain('saved-key')
    expect(original.name).toBe('DeepSeek')

    const reset = await reopened.delete('deepseek')
    expect(reset.activeProfileId).toBe('deepseek')
    expect(reset.profiles.find((profile) => profile.id === 'deepseek')).toEqual(original)
    expect(reset.apiKeyConfigured.deepseek).toBe(true)
    expect(await reopened.getApiKey('deepseek')).toBe('saved-key')
    await expect(reopened.delete('deepseek')).resolves.toMatchObject({
      activeProfileId: 'deepseek',
    })
  })

  it('derives built-in identity from the id, and supports the inherited Codex preset', async () => {
    const { service } = await createService()
    const saved = await service.upsert(customProfile({ builtIn: true }))
    expect(saved.profiles.find((profile) => profile.id === 'myendpoint')?.builtIn).toBe(
      false,
    )
    const codex = BUILTIN_MODEL_PROFILES[0]!
    const inherited = { ...codex, name: 'My Codex', builtIn: false }
    const state = await service.upsert(inherited)
    expect(state.profiles.find((profile) => profile.id === 'codex')).toEqual({
      ...inherited,
      builtIn: true,
    })
    await expect(service.upsert(customProfile({ baseUrl: null }))).rejects.toThrow(
      'Base URL',
    )
    await expect(
      service.upsert({ ...codex, models: customProfile().models }),
    ).rejects.toThrow('Codex CLI')
  })

  it('does not reuse an in-flight write of the old configuration when saving an edit', async () => {
    const { configRoot, service, settingsStore } = await createService()
    await service.select('deepseek')
    const original = await service.activeProfile()
    const write = profileConfigHome.writeProfileConfigHome
    let release!: () => void
    let started!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const spy = vi
      .spyOn(profileConfigHome, 'writeProfileConfigHome')
      .mockImplementationOnce(async (...args) => {
        started()
        await blocked
        await write(...args)
      })
    try {
      const listing = service.list()
      await ready
      const updating = service.upsert({ ...original, name: 'Updated DeepSeek' })
      await vi.waitFor(async () => {
        expect(await settingsStore.get('agent.modelProfiles')).toMatchObject([
          { name: 'Updated DeepSeek' },
        ])
      })
      release()
      await Promise.all([listing, updating])
      expect(
        await readFile(join(configRoot, 'deepseek', 'config.toml'), 'utf8'),
      ).toContain('name = "Updated DeepSeek"')
    } finally {
      release()
      spy.mockRestore()
    }
  })

  it('setApiKey stores the key and selects the profile', async () => {
    const { service } = await createService()
    await service.upsert(customProfile())
    const state = await service.setApiKey('myendpoint', ' my-key ')
    expect(state.activeProfileId).toBe('myendpoint')
    expect(state.apiKeyConfigured['myendpoint']).toBe(true)
    await expect(service.getApiKey('myendpoint')).resolves.toBe('my-key')
    await expect(service.select('missing')).rejects.toThrow('未知的模型配置')
  })
})
