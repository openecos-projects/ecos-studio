export type DesktopCodexDependencyState =
  | 'missing'
  | 'installing'
  | 'needs_api_key'
  | 'ready'
  | 'error'

export type DesktopCodexModelSource = 'codex' | 'glm'

export type DesktopCodexAuthState = 'authenticated' | 'unauthenticated' | 'unknown'

export interface DesktopCodexDependencyStatus {
  authState: DesktopCodexAuthState
  apiKeyConfigured?: boolean
  binPath?: string
  message?: string
  modelSource?: DesktopCodexModelSource
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

export interface DesktopCodexSetModelSourceRequest {
  source: DesktopCodexModelSource
}

export interface DesktopCodexSetApiKeyRequest {
  apiKey: string
}

export const DESKTOP_CODEX_BIN_SETTING_KEY = 'agent.codexBin'
export const DESKTOP_CODEX_MODEL_SOURCE_SETTING_KEY = 'agent.modelSource'
export const DESKTOP_GLM_API_KEY_SETTING_KEY = 'agent.glmApiKey'
export const DESKTOP_OPENAI_API_KEY_SETTING_KEY = 'agent.openaiApiKey'
