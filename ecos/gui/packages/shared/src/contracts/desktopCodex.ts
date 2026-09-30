export type DesktopCodexDependencyState =
  | 'missing'
  | 'installing'
  | 'needs_api_key'
  | 'ready'
  | 'error'

export type DesktopCodexAuthState = 'authenticated' | 'unauthenticated' | 'unknown'

export type DesktopModelProfileWireApi = 'responses' | 'chat'

export interface DesktopModelProfileModel {
  slug: string
  displayName: string
  contextWindow: number
}

/**
 * One model endpoint configuration riding on the codex CLI engine. Built-in
 * profiles ship with the app; custom profiles are user-managed. Profiles with
 * `baseUrl: null` use the codex CLI's own default configuration (no managed
 * CODEX_HOME is generated).
 */
export interface DesktopModelProfile {
  id: string
  name: string
  baseUrl: string | null
  wireApi: DesktopModelProfileWireApi
  envKey: string
  models: DesktopModelProfileModel[]
  defaultModel: string
  builtIn: boolean
}

export interface DesktopModelProfileState {
  profiles: DesktopModelProfile[]
  activeProfileId: string
  /** profileId → whether an API key is stored. Keys themselves never leave main. */
  apiKeyConfigured: Record<string, boolean>
}

export interface DesktopCodexDependencyStatus {
  authState: DesktopCodexAuthState
  activeProfileId?: string
  apiKeyConfigured?: boolean
  binPath?: string
  message?: string
  platformSupportsInstall: boolean
  progressMessage?: string
  progressRatio?: number
  state: DesktopCodexDependencyState
  version?: string
}

export interface DesktopCodexInstallProgressEvent {
  message: string
  phase: 'downloading' | 'extracting' | 'verifying' | 'done' | 'error'
  progress?: number
}

export interface DesktopCodexSetBinPathRequest {
  path: string
}

export interface DesktopModelProfileUpsertRequest {
  profile: DesktopModelProfile
}

export interface DesktopModelProfileIdRequest {
  profileId: string
}

export interface DesktopModelProfileSetApiKeyRequest {
  profileId: string
  apiKey: string
}

export const DESKTOP_CODEX_BIN_SETTING_KEY = 'agent.codexBin'
export const DESKTOP_MODEL_PROFILES_SETTING_KEY = 'agent.modelProfiles'
export const DESKTOP_ACTIVE_MODEL_PROFILE_SETTING_KEY = 'agent.activeProfileId'
