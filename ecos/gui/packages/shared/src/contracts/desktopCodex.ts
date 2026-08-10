export type DesktopCodexDependencyState =
  | 'missing'
  | 'installing'
  | 'installed_needs_login'
  | 'ready'
  | 'error'

export type DesktopCodexAuthState = 'authenticated' | 'unauthenticated' | 'unknown'

export interface DesktopCodexDependencyStatus {
  authState: DesktopCodexAuthState
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

export const DESKTOP_CODEX_BIN_SETTING_KEY = 'agent.codexBin'
