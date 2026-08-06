import { reactive } from 'vue'
import type {
  DesktopAgentChoice,
  DesktopAgentEvent,
  DesktopAgentRunStatus,
} from '@ecos-studio/shared'

export type AgentContractSurface = 'setup' | 'rerun' | 'continue' | 'parameter'

export type PendingGuiAction =
  | {
      type: 'rerun'
      contract: NonNullable<DesktopAgentEvent['workspaceRerun']>
      token: string
    }
  | {
      type: 'optimization'
      contract: NonNullable<DesktopAgentEvent['workspaceOptimization']>
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

export interface AgentSessionUiState {
  runStatus: DesktopAgentRunStatus
  inputValue: string
  queuedMessage: string
  isConnecting: boolean
  isRequestPending: boolean
  isInterruptPending: boolean
  isWorkspaceCreationPending: boolean
  isWorkspaceRerunPending: boolean
  isWorkspaceOptimizationPending: boolean
  isWorkspaceContinuePending: boolean
  isWorkspaceParameterPending: boolean
  workspaceSetupContract?: DesktopAgentEvent['workspaceSetup']
  workspaceSetupMessage: string
  workspaceSetupChoice?: DesktopAgentChoice
  workspaceSetupAnsweredOptionId: string
  workspaceSetupAnchorTurnId?: string
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
  pendingParameterUpdate?: NonNullable<DesktopAgentEvent['workspaceParameterUpdate']>
  lastContractSurface?: AgentContractSurface
  pendingGuiAction?: PendingGuiAction
}

export function createAgentSessionUiState(): AgentSessionUiState {
  return {
    runStatus: 'idle',
    inputValue: '',
    queuedMessage: '',
    isConnecting: false,
    isRequestPending: false,
    isInterruptPending: false,
    isWorkspaceCreationPending: false,
    isWorkspaceRerunPending: false,
    isWorkspaceOptimizationPending: false,
    isWorkspaceContinuePending: false,
    isWorkspaceParameterPending: false,
    workspaceSetupMessage: '',
    workspaceSetupAnsweredOptionId: '',
    workspaceRerunMessage: '',
    workspaceRerunAnsweredOptionId: '',
    workspaceContinueMessage: '',
    workspaceContinueAnsweredOptionId: '',
    workspaceParameterMessage: '',
    workspaceParameterAnsweredOptionId: '',
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
