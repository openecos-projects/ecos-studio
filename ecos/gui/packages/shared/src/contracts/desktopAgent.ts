export type DesktopAgentStatusState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'running'
  | 'error'

export interface DesktopAgentProviderRequest {
  providerId?: string
}

export interface DesktopAgentStartRequest extends DesktopAgentProviderRequest {
  directory?: string
}

export interface DesktopAgentStartSessionRequest extends DesktopAgentProviderRequest {
  directory?: string
  sessionId?: string
  workspaceId?: string
}

export interface DesktopAgentStartSessionResponse {
  sessionId: string
}

export interface DesktopAgentSendMessageRequest extends DesktopAgentProviderRequest {
  message: string
  sessionId: string
}

export interface DesktopAgentSendMessageResponse {
  messageId?: string
  sessionId: string
  text?: string
  turnId?: string
}

export interface DesktopAgentStatus {
  activeSessionId?: string
  message?: string
  providerId: string
  state: DesktopAgentStatusState
}

export interface DesktopAgentSetModeRequest extends DesktopAgentProviderRequest {
  mode: string
}

export interface DesktopAgentSessionSummary {
  directory?: string
  sessionId: string
  title?: string
  updatedAt?: string
  workspaceId?: string
}

export interface DesktopAgentListSessionsRequest extends DesktopAgentProviderRequest {
  directory?: string
  workspaceId?: string
}

export interface DesktopAgentListSessionsResponse {
  sessions: DesktopAgentSessionSummary[]
}

export interface DesktopAgentResumeSessionRequest extends DesktopAgentProviderRequest {
  sessionId: string
}

export interface DesktopAgentResumeSessionResponse {
  sessionId: string
}

export interface DesktopAgentContractField {
  label: string
  value: string
}

export interface DesktopAgentExecutionContract {
  fields: DesktopAgentContractField[]
  schema_version: 'flow-agent.resolved_execution_contract.v1'
  title: string
}

export interface DesktopAgentWorkspaceSetupParameters {
  clock: string
  design: string
  die_area_mode: 'utilitization_margin' | 'width_height'
  die_height?: number
  die_width?: number
  frequency_max: number
  margin: number
  target_density: number
  target_overflow: number
  top_module: string
  utilitization?: number
}

export interface DesktopAgentWorkspaceSetupContract {
  flow_config: {
    end_step: string
    start_step: string
    steps: string[]
  }
  parameters: DesktopAgentWorkspaceSetupParameters
  pdk: 'ics55'
  requires_gui_review: true
  schema_version: 'flow-agent.workspace_setup_contract.v1'
  suggested_workspace_name?: string
  title: string
}

export type DesktopAgentEventType =
  | 'status'
  | 'session'
  | 'message'
  | 'tool'
  | 'contract'
  | 'workspace_setup'
  | 'error'

export interface DesktopAgentEvent {
  contract?: DesktopAgentExecutionContract
  providerId?: string
  sessionId?: string
  text?: string
  type: DesktopAgentEventType
  workspaceSetup?: DesktopAgentWorkspaceSetupContract
}
