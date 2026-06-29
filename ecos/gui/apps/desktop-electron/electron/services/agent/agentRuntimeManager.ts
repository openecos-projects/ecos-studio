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
import { RuntimeEventFanout } from '../runtime/runtimeEvents'

export interface AgentRuntimeProviderRegistration {
  providerId: string
  runtime: AgentProviderRuntime
}

export interface AgentRuntimeManagerOptions {
  defaultProviderId?: string
  providers: AgentRuntimeProviderRegistration[]
}

export class AgentRuntimeManager implements AgentProviderRuntime {
  private readonly defaultProviderId: string
  private readonly eventFanout = new RuntimeEventFanout<DesktopAgentEvent>()
  private readonly providers = new Map<string, AgentProviderRuntime>()

  constructor(provider: AgentProviderRuntime)
  constructor(options: AgentRuntimeManagerOptions)
  constructor(input: AgentProviderRuntime | AgentRuntimeManagerOptions) {
    const options = isAgentRuntimeManagerOptions(input)
      ? input
      : {
          defaultProviderId: 'codex',
          providers: [
            {
              providerId: 'codex',
              runtime: input,
            },
          ],
        }
    if (options.providers.length === 0) {
      throw new Error('AgentRuntimeManager requires at least one provider')
    }

    for (const { providerId, runtime } of options.providers) {
      if (this.providers.has(providerId)) {
        throw new Error(`Duplicate agent provider: ${providerId}`)
      }
      this.providers.set(providerId, runtime)
    }

    this.defaultProviderId = options.defaultProviderId ?? options.providers[0].providerId
    if (!this.providers.has(this.defaultProviderId)) {
      throw new Error(`Unknown default agent provider: ${this.defaultProviderId}`)
    }

    for (const { providerId, runtime } of options.providers) {
      runtime.onEvent((event) => {
        this.eventFanout.emit({
          ...event,
          providerId,
        })
      })
    }
  }

  async start(request?: DesktopAgentStartRequest): Promise<void> {
    return await this.providerForRequest(request).start(request)
  }

  async startSession(request: DesktopAgentStartSessionRequest): Promise<DesktopAgentStartSessionResponse> {
    return await this.providerForRequest(request).startSession(request)
  }

  async sendMessage(request: DesktopAgentSendMessageRequest): Promise<DesktopAgentSendMessageResponse> {
    return await this.providerForRequest(request).sendMessage(request)
  }

  async interrupt(request?: DesktopAgentProviderRequest): Promise<void> {
    return await this.providerForRequest(request).interrupt(request)
  }

  async getStatus(request?: DesktopAgentProviderRequest): Promise<DesktopAgentStatus> {
    return await this.providerForRequest(request).getStatus(request)
  }

  async setMode(request: DesktopAgentSetModeRequest): Promise<DesktopAgentStatus> {
    return await this.providerForRequest(request).setMode(request)
  }

  async listSessions(request: DesktopAgentListSessionsRequest): Promise<DesktopAgentListSessionsResponse> {
    return await this.providerForRequest(request).listSessions(request)
  }

  async resumeSession(request: DesktopAgentResumeSessionRequest): Promise<DesktopAgentResumeSessionResponse> {
    return await this.providerForRequest(request).resumeSession(request)
  }

  async stop(request?: DesktopAgentProviderRequest): Promise<void> {
    return await this.providerForRequest(request).stop(request)
  }

  onEvent(listener: (event: DesktopAgentEvent) => void): () => void {
    return this.eventFanout.onEvent(listener)
  }

  private providerForRequest(request?: DesktopAgentProviderRequest): AgentProviderRuntime {
    const providerId = request?.providerId ?? this.defaultProviderId
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Unknown agent provider: ${providerId}`)
    }
    return provider
  }
}

function isAgentRuntimeManagerOptions(
  input: AgentProviderRuntime | AgentRuntimeManagerOptions,
): input is AgentRuntimeManagerOptions {
  return Array.isArray((input as AgentRuntimeManagerOptions).providers)
}
