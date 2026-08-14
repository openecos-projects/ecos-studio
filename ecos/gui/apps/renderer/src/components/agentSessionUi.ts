import { reactive } from 'vue'
import type {
  DesktopAgentChoice,
  DesktopAgentEvent,
  DesktopAgentRunStatus,
} from '@ecos-studio/shared'

export type AgentContractSurface =
  | 'setup'
  | 'rerun'
  | 'continue'
  | 'parameter'
  | 'signoff'

export type PendingGuiAction =
  | {
      type: 'rerun'
      contract: NonNullable<DesktopAgentEvent['workspaceRerun']>
      token: string
    }
  | {
      type: 'continue'
      payload: NonNullable<DesktopAgentEvent['workspaceContinue']>
    }
  | {
      type: 'parameter'
      payload: NonNullable<DesktopAgentEvent['workspaceParameterUpdate']>
    }
  | {
      type: 'signoff'
      contract: NonNullable<DesktopAgentEvent['workspaceSignoff']>
    }

export interface AgentSessionUiState {
  runStatus: DesktopAgentRunStatus
  inputValue: string
  inputHistoryIndex?: number
  inputHistoryDraft: string
  queuedMessage: string
  isConnecting: boolean
  isRequestPending: boolean
  isInterruptPending: boolean
  isWorkspaceCreationPending: boolean
  isWorkspaceRerunPending: boolean
  isWorkspaceContinuePending: boolean
  isWorkspaceParameterPending: boolean
  isWorkspaceSignoffPending: boolean
  workspaceSetupContract?: DesktopAgentEvent['workspaceSetup']
  workspaceSetupMessage: string
  workspaceSetupChoice?: DesktopAgentChoice
  workspaceSetupAnsweredOptionId: string
  workspaceSetupAnchorTurnId?: string
  workspaceSetupStartedId?: string
  workspaceCreateSetupId?: string
  workspaceRerunContract?: NonNullable<DesktopAgentEvent['contract']>
  workspaceRerunMessage: string
  workspaceRerunChoice?: DesktopAgentChoice
  workspaceRerunAnsweredOptionId: string
  workspaceRerunAnchorTurnId?: string
  workspaceContinueContract?: NonNullable<DesktopAgentEvent['contract']>
  workspaceContinueMessage: string
  workspaceContinueChoice?: DesktopAgentChoice
  workspaceContinueAnsweredOptionId: string
  workspaceContinueAnchorTurnId?: string
  workspaceParameterContract?: NonNullable<DesktopAgentEvent['contract']>
  workspaceParameterMessage: string
  workspaceParameterChoice?: DesktopAgentChoice
  workspaceParameterAnsweredOptionId: string
  workspaceParameterAnchorTurnId?: string
  workspaceSignoffChoice?: DesktopAgentChoice
  workspaceSignoffAnsweredOptionId: string
  workspaceSignoffAnchorTurnId?: string
  workspaceSignoffOutputPath: string
  workspaceSignoffPathInputVisible: boolean
  pendingParameterUpdate?: NonNullable<DesktopAgentEvent['workspaceParameterUpdate']>
  lastContractSurface?: AgentContractSurface
  pendingGuiAction?: PendingGuiAction
}

export function createAgentSessionUiState(): AgentSessionUiState {
  return {
    runStatus: 'idle',
    inputValue: '',
    inputHistoryDraft: '',
    queuedMessage: '',
    isConnecting: false,
    isRequestPending: false,
    isInterruptPending: false,
    isWorkspaceCreationPending: false,
    isWorkspaceRerunPending: false,
    isWorkspaceContinuePending: false,
    isWorkspaceParameterPending: false,
    isWorkspaceSignoffPending: false,
    workspaceSetupMessage: '',
    workspaceSetupAnsweredOptionId: '',
    workspaceRerunMessage: '',
    workspaceRerunAnsweredOptionId: '',
    workspaceContinueMessage: '',
    workspaceContinueAnsweredOptionId: '',
    workspaceParameterMessage: '',
    workspaceParameterAnsweredOptionId: '',
    workspaceSignoffAnsweredOptionId: '',
    workspaceSignoffOutputPath: '',
    workspaceSignoffPathInputVisible: false,
  }
}

export const GUI_SWITCH_PROMPT =
  'Please switch to this chat, then confirm again to continue the UI action.'

/** Survives Home ↔ Workspace remounts of AIChatPanel. */
export const agentSessionUiById = reactive<Record<string, AgentSessionUiState>>({})

export function getAgentSessionUi(sessionId: string): AgentSessionUiState {
  if (!agentSessionUiById[sessionId]) {
    agentSessionUiById[sessionId] = createAgentSessionUiState()
  }
  return agentSessionUiById[sessionId]!
}

export function removeAgentSessionUi(sessionId: string): void {
  delete agentSessionUiById[sessionId]
}

export function resetInputHistoryNavigation(state: AgentSessionUiState): void {
  state.inputHistoryIndex = undefined
  state.inputHistoryDraft = ''
}

export function navigateInputHistory(
  state: AgentSessionUiState,
  history: readonly string[],
  direction: -1 | 1,
): boolean {
  if (history.length === 0) return false
  if (state.inputHistoryIndex === undefined) {
    if (direction > 0) return false
    state.inputHistoryDraft = state.inputValue
    state.inputHistoryIndex = history.length - 1
  } else {
    const nextIndex = state.inputHistoryIndex + direction
    if (nextIndex < 0) state.inputHistoryIndex = 0
    else if (nextIndex >= history.length) {
      state.inputValue = state.inputHistoryDraft
      resetInputHistoryNavigation(state)
      return true
    } else {
      state.inputHistoryIndex = nextIndex
    }
  }
  state.inputValue = history[state.inputHistoryIndex]
  return true
}
