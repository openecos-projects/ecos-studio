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
import type { AgentProviderRuntime } from './agentProviderContract'

export class AgentRuntimeManager implements AgentProviderRuntime {
  constructor(private readonly provider: AgentProviderRuntime) {}

  start(request?: DesktopAgentStartRequest): Promise<void> {
    return this.provider.start(request)
  }

  startSession(request: DesktopAgentStartSessionRequest): Promise<DesktopAgentStartSessionResponse> {
    return this.provider.startSession(request)
  }

  sendMessage(request: DesktopAgentSendMessageRequest): Promise<DesktopAgentSendMessageResponse> {
    return this.provider.sendMessage(request)
  }

  interrupt(request?: DesktopAgentProviderRequest): Promise<void> {
    return this.provider.interrupt(request)
  }

  getStatus(request?: DesktopAgentProviderRequest): Promise<DesktopAgentStatus> {
    return this.provider.getStatus(request)
  }

  setMode(request: DesktopAgentSetModeRequest): Promise<DesktopAgentStatus> {
    return this.provider.setMode(request)
  }

  listSessions(request: DesktopAgentListSessionsRequest): Promise<DesktopAgentListSessionsResponse> {
    return this.provider.listSessions(request)
  }

  resumeSession(request: DesktopAgentResumeSessionRequest): Promise<DesktopAgentResumeSessionResponse> {
    return this.provider.resumeSession(request)
  }

  stop(request?: DesktopAgentProviderRequest): Promise<void> {
    return this.provider.stop(request)
  }

  onEvent(listener: (event: DesktopAgentEvent) => void): () => void {
    return this.provider.onEvent(listener)
  }
}
