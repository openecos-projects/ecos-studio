import type {
  DesktopAgentEvent,
  DesktopAgentInteractionAnswerRequest,
  DesktopAgentInteractionAnswerResponse,
  DesktopAgentInterruptRequest,
  DesktopAgentListSessionsRequest,
  DesktopAgentListSessionsResponse,
  DesktopAgentModelSettings,
  DesktopAgentModelSettingsRequest,
  DesktopAgentOptimizationEpisodeResumeRequest,
  DesktopAgentOptimizationEpisodeNotificationAckRequest,
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
  resumeOptimizationEpisode(
    request: DesktopAgentOptimizationEpisodeResumeRequest,
  ): Promise<void>
  stopOptimizationEpisode(
    request: DesktopAgentOptimizationEpisodeResumeRequest,
  ): Promise<void>
  acknowledgeOptimizationEpisodeNotification?(
    request: DesktopAgentOptimizationEpisodeNotificationAckRequest,
  ): void
  prepareOptimizationShutdown(request: DesktopAgentInterruptRequest): Promise<void>
  cancelOptimizationShutdown(request: DesktopAgentInterruptRequest): Promise<void>
  stop(request?: DesktopAgentProviderRequest): Promise<void>
  onEvent(listener: (event: DesktopAgentEvent) => void): () => void
}
