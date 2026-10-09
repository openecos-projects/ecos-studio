import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DESKTOP_ACTIVE_MODEL_PROFILE_SETTING_KEY,
  DESKTOP_MODEL_PROFILES_SETTING_KEY,
  type DesktopModelProfile,
  type DesktopModelProfileState,
  type DesktopSettingsValue,
} from '@ecos-studio/shared'
import type { CodexDependencySettingsStore } from './codexDependencyService'
import { BUILTIN_MODEL_PROFILES, writeProfileConfigHome } from './profileConfigHome'

/**
 * cc-switch style model profile registry: built-in profiles ship in code,
 * local overrides and custom profiles persist in the settings store, and one profile is
 * active. Profiles with a base URL get a managed CODEX_HOME materialized on
 * selection (see profileConfigHome).
 */

// Pre-profile settings keys, consumed once by the migration below.
const LEGACY_MODEL_SOURCE_KEY = 'agent.modelSource'
const LEGACY_GLM_API_KEY = 'agent.glmApiKey'
const LEGACY_OPENAI_API_KEY = 'agent.openaiApiKey'

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function modelProfileApiKeySettingKey(profileId: string): string {
  return `agent.profile.${profileId}.apiKey`
}

export interface ModelProfileServiceOptions {
  configRoot?: string
  settingsStore: CodexDependencySettingsStore
  homedir?: () => string
}

export class ModelProfileService {
  private readonly configRoot: string
  private readonly settingsStore: CodexDependencySettingsStore
  private migrated: Promise<void> | null = null
  private readonly materializePromises = new Map<string, Promise<void>>()

  constructor(options: ModelProfileServiceOptions) {
    this.settingsStore = options.settingsStore
    this.configRoot =
      options.configRoot ??
      join(
        (options.homedir ?? homedir)(),
        '.local',
        'share',
        'ecos-studio',
        'codex-profiles',
      )
  }

  configHomeFor(profileId: string): string {
    return join(this.configRoot, profileId)
  }

  async list(): Promise<DesktopModelProfileState> {
    const profiles = await this.allProfiles()
    const active = await this.activeProfile()
    // Re-materialize so on-disk config homes pick up built-in profile fixes
    // (e.g. wire_api changes) without requiring a re-select.
    await this.materialize(active)
    const apiKeyConfigured: Record<string, boolean> = {}
    for (const profile of profiles) {
      apiKeyConfigured[profile.id] = (await this.getApiKey(profile.id)) !== null
    }
    return {
      profiles,
      activeProfileId: active.id,
      apiKeyConfigured,
    }
  }

  async activeProfile(): Promise<DesktopModelProfile> {
    await this.ensureMigrated()
    const stored = await this.settingsStore.get<string>(
      DESKTOP_ACTIVE_MODEL_PROFILE_SETTING_KEY,
    )
    const profiles = await this.allProfiles()
    return profiles.find((profile) => profile.id === stored) ?? BUILTIN_MODEL_PROFILES[0]
  }

  async knownEnvKeys(): Promise<string[]> {
    const keys = new Set((await this.allProfiles()).map((profile) => profile.envKey))
    return [...keys]
  }

  async getApiKey(profileId: string): Promise<string | null> {
    const stored = await this.settingsStore.get<string>(
      modelProfileApiKeySettingKey(profileId),
    )
    return typeof stored === 'string' && stored.trim() ? stored.trim() : null
  }

  async upsert(input: unknown): Promise<DesktopModelProfileState> {
    const profile = validateProfile(input)
    if (profile.wireApi !== 'responses') {
      throw new Error('当前 Codex CLI 仅支持 responses 协议')
    }
    const stored = await this.storedProfiles()
    const index = stored.findIndex((item) => item.id === profile.id)
    if (index >= 0) stored[index] = profile
    else stored.push(profile)
    await this.settingsStore.set(
      DESKTOP_MODEL_PROFILES_SETTING_KEY,
      stored as unknown as DesktopSettingsValue,
    )
    return await this.list()
  }

  async delete(profileId: string): Promise<DesktopModelProfileState> {
    const stored = await this.storedProfiles()
    const next = stored.filter((profile) => profile.id !== profileId)
    const builtIn = isBuiltinProfileId(profileId)
    if (!builtIn && next.length === stored.length) {
      throw new Error(`未知的模型配置: ${profileId}`)
    }
    const active = await this.activeProfile()
    await this.settingsStore.set(
      DESKTOP_MODEL_PROFILES_SETTING_KEY,
      next as unknown as DesktopSettingsValue,
    )
    // Removing a built-in override restores its defaults, not its credentials.
    if (!builtIn) {
      await this.settingsStore.delete(modelProfileApiKeySettingKey(profileId))
      if (active.id === profileId) {
        await this.settingsStore.set(DESKTOP_ACTIVE_MODEL_PROFILE_SETTING_KEY, 'codex')
      }
    }
    return await this.list()
  }

  async select(profileId: string): Promise<DesktopModelProfileState> {
    const profile = (await this.allProfiles()).find((item) => item.id === profileId)
    if (!profile) {
      throw new Error(`未知的模型配置: ${profileId}`)
    }
    await this.settingsStore.set(DESKTOP_ACTIVE_MODEL_PROFILE_SETTING_KEY, profile.id)
    await this.materialize(profile)
    return await this.list()
  }

  async setApiKey(profileId: string, apiKey: string): Promise<DesktopModelProfileState> {
    const trimmed = apiKey.trim()
    if (!trimmed || trimmed.length > 4096) {
      throw new Error('API Key 不能为空')
    }
    if (!(await this.allProfiles()).some((profile) => profile.id === profileId)) {
      throw new Error(`未知的模型配置: ${profileId}`)
    }
    await this.settingsStore.set(modelProfileApiKeySettingKey(profileId), trimmed)
    // Saving a key implies using that profile — the “保存并使用” action.
    return await this.select(profileId)
  }

  private async allProfiles(): Promise<DesktopModelProfile[]> {
    await this.ensureMigrated()
    const stored = await this.storedProfiles()
    return [
      ...BUILTIN_MODEL_PROFILES.map(
        (profile) => stored.find((item) => item.id === profile.id) ?? profile,
      ),
      ...stored.filter((profile) => !profile.builtIn),
    ]
  }

  private async storedProfiles(): Promise<DesktopModelProfile[]> {
    const stored = await this.settingsStore.get(DESKTOP_MODEL_PROFILES_SETTING_KEY)
    if (!Array.isArray(stored)) return []
    return stored.flatMap((item) => {
      try {
        return [validateProfile(item)]
      } catch {
        return []
      }
    })
  }

  private async materialize(profile: DesktopModelProfile): Promise<void> {
    if (!profile.baseUrl) return
    const previous = this.materializePromises.get(profile.id) ?? Promise.resolve()
    const pending = previous
      .then(() => writeProfileConfigHome(this.configHomeFor(profile.id), profile))
      .finally(() => {
        if (this.materializePromises.get(profile.id) === pending) {
          this.materializePromises.delete(profile.id)
        }
      })
    this.materializePromises.set(profile.id, pending)
    await pending
  }

  private ensureMigrated(): Promise<void> {
    this.migrated ??= this.runMigration()
    return this.migrated
  }

  private async runMigration(): Promise<void> {
    const [legacySource, glmKey, openaiKey, activeProfileId] = await Promise.all([
      this.settingsStore.get<string>(LEGACY_MODEL_SOURCE_KEY),
      this.settingsStore.get<string>(LEGACY_GLM_API_KEY),
      this.settingsStore.get<string>(LEGACY_OPENAI_API_KEY),
      this.settingsStore.get<string>(DESKTOP_ACTIVE_MODEL_PROFILE_SETTING_KEY),
    ])
    if (typeof glmKey === 'string' && glmKey.trim()) {
      await this.settingsStore.set(modelProfileApiKeySettingKey('glm'), glmKey.trim())
    }
    if (typeof openaiKey === 'string' && openaiKey.trim()) {
      await this.settingsStore.set(
        modelProfileApiKeySettingKey('codex'),
        openaiKey.trim(),
      )
    }
    if (!activeProfileId && legacySource === 'glm') {
      await this.settingsStore.set(DESKTOP_ACTIVE_MODEL_PROFILE_SETTING_KEY, 'glm')
    }
    await Promise.all([
      this.settingsStore.delete(LEGACY_MODEL_SOURCE_KEY),
      this.settingsStore.delete(LEGACY_GLM_API_KEY),
      this.settingsStore.delete(LEGACY_OPENAI_API_KEY),
    ])
  }
}

function validateProfile(input: unknown): DesktopModelProfile {
  const record =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null
  if (!record) throw new Error('模型配置格式无效')
  const profile: DesktopModelProfile = {
    id: String(record.id ?? ''),
    name: String(record.name ?? '').trim(),
    baseUrl:
      record.baseUrl === null && record.id === 'codex'
        ? null
        : typeof record.baseUrl === 'string'
          ? record.baseUrl.trim()
          : '',
    wireApi: record.wireApi as DesktopModelProfile['wireApi'],
    envKey: String(record.envKey ?? '').trim(),
    models: Array.isArray(record.models)
      ? record.models.map((item) => {
          const model =
            typeof item === 'object' && item !== null
              ? (item as Record<string, unknown>)
              : {}
          return {
            slug: String(model.slug ?? '').trim(),
            displayName: String(model.displayName ?? '').trim(),
            contextWindow: Number(model.contextWindow),
          }
        })
      : [],
    defaultModel: String(record.defaultModel ?? '').trim(),
    builtIn: isBuiltinProfileId(String(record.id ?? '')),
  }
  if (!PROFILE_ID_PATTERN.test(profile.id)) {
    throw new Error('模型配置 id 无效')
  }
  if (!profile.name || profile.name.length > 64 || /\p{Cc}/u.test(profile.name)) {
    throw new Error('模型配置名称无效')
  }
  if (profile.baseUrl !== null) {
    try {
      const url = new URL(profile.baseUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
      if (/\p{Cc}/u.test(profile.baseUrl)) throw new Error()
    } catch {
      throw new Error('Base URL 必须是 http(s) 地址')
    }
  }
  if (profile.wireApi !== 'responses' && profile.wireApi !== 'chat') {
    throw new Error('wire_api 必须是 responses 或 chat')
  }
  if (!ENV_KEY_PATTERN.test(profile.envKey)) {
    throw new Error('API Key 环境变量名无效')
  }
  if (profile.baseUrl === null) {
    if (
      profile.models.length ||
      profile.defaultModel ||
      profile.envKey !== 'OPENAI_API_KEY'
    ) {
      throw new Error(
        '使用现有 Codex CLI 配置时，模型由 CLI 管理，Key 使用 OPENAI_API_KEY',
      )
    }
    return profile
  }
  if (profile.models.length < 1 || profile.models.length > 32) {
    throw new Error('模型列表需要 1-32 项')
  }
  for (const model of profile.models) {
    if (
      !MODEL_SLUG_PATTERN.test(model.slug) ||
      !model.displayName ||
      model.displayName.length > 128 ||
      !Number.isInteger(model.contextWindow) ||
      model.contextWindow < 1024 ||
      model.contextWindow > 4_000_000
    ) {
      throw new Error(`模型条目无效: ${model.slug || '(空)'}`)
    }
  }
  if (new Set(profile.models.map((model) => model.slug)).size !== profile.models.length) {
    throw new Error('模型 slug 不能重复')
  }
  if (!profile.models.some((model) => model.slug === profile.defaultModel)) {
    throw new Error('默认模型必须在模型列表中')
  }
  return profile
}

function isBuiltinProfileId(profileId: string): boolean {
  return BUILTIN_MODEL_PROFILES.some((profile) => profile.id === profileId)
}
