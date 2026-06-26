import type {
  DesktopAgentEvent,
  DesktopAgentListSessionsRequest,
  DesktopAgentListSessionsResponse,
  DesktopAgentProviderRequest,
  DesktopAgentResumeSessionRequest,
  DesktopAgentResumeSessionResponse,
  DesktopAgentSendMessageRequest,
  DesktopAgentSendMessageResponse,
  DesktopAgentSetModeRequest,
  DesktopAgentStartRequest,
  DesktopAgentStartSessionRequest,
  DesktopAgentStartSessionResponse,
  DesktopAgentStatus,
} from '@ecos-studio/shared'

export interface AgentProviderRuntime {
  start(request?: DesktopAgentStartRequest): Promise<void>
  startSession(request: DesktopAgentStartSessionRequest): Promise<DesktopAgentStartSessionResponse>
  sendMessage(request: DesktopAgentSendMessageRequest): Promise<DesktopAgentSendMessageResponse>
  interrupt(request?: DesktopAgentProviderRequest): Promise<void>
  getStatus(request?: DesktopAgentProviderRequest): Promise<DesktopAgentStatus>
  setMode(request: DesktopAgentSetModeRequest): Promise<DesktopAgentStatus>
  listSessions(request: DesktopAgentListSessionsRequest): Promise<DesktopAgentListSessionsResponse>
  resumeSession(request: DesktopAgentResumeSessionRequest): Promise<DesktopAgentResumeSessionResponse>
  stop(request?: DesktopAgentProviderRequest): Promise<void>
  onEvent(listener: (event: DesktopAgentEvent) => void): () => void
}
