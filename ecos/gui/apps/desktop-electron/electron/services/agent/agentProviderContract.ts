import type {
  DesktopAgentEvent,
  DesktopAgentInteractionAnswerRequest,
  DesktopAgentInteractionAnswerResponse,
  DesktopAgentListSessionsRequest,
  DesktopAgentListSessionsResponse,
  DesktopAgentModelSettings,
  DesktopAgentModelSettingsRequest,
  DesktopAgentProviderRequest,
  DesktopAgentResumeSessionRequest,
  DesktopAgentResumeSessionResponse,
  DesktopAgentSendMessageRequest,
  DesktopAgentSendMessageResponse,
  DesktopAgentSetModelSettingsRequest,
  DesktopAgentSetModeRequest,
  DesktopAgentStartRequest,
  DesktopAgentStartSessionRequest,
  DesktopAgentStartSessionResponse,
  DesktopAgentStatus,
} from '@ecos-studio/shared'

export interface AgentProviderRuntime {
  start(request?: DesktopAgentStartRequest): Promise<void>
  startSession(
    request: DesktopAgentStartSessionRequest,
  ): Promise<DesktopAgentStartSessionResponse>
  sendMessage(
    request: DesktopAgentSendMessageRequest,
  ): Promise<DesktopAgentSendMessageResponse>
  getModelSettings(
    request: DesktopAgentModelSettingsRequest,
  ): Promise<DesktopAgentModelSettings>
  setModelSettings(
    request: DesktopAgentSetModelSettingsRequest,
  ): Promise<DesktopAgentModelSettings>
  answerInteraction(
    request: DesktopAgentInteractionAnswerRequest,
  ): Promise<DesktopAgentInteractionAnswerResponse>
  interrupt(request?: DesktopAgentProviderRequest): Promise<void>
  getStatus(request?: DesktopAgentProviderRequest): Promise<DesktopAgentStatus>
  setMode(request: DesktopAgentSetModeRequest): Promise<DesktopAgentStatus>
  listSessions(
    request: DesktopAgentListSessionsRequest,
  ): Promise<DesktopAgentListSessionsResponse>
  resumeSession(
    request: DesktopAgentResumeSessionRequest,
  ): Promise<DesktopAgentResumeSessionResponse>
  stop(request?: DesktopAgentProviderRequest): Promise<void>
  onEvent(listener: (event: DesktopAgentEvent) => void): () => void
}
