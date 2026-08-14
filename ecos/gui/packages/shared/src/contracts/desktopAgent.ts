export type DesktopAgentStatusState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'running'
  | 'error'

export interface DesktopAgentProviderRequest {
  providerId?: string
}

export interface DesktopAgentInterruptRequest extends DesktopAgentProviderRequest {
  sessionId: string
}

export interface DesktopAgentStartRequest extends DesktopAgentProviderRequest {
  directory?: string
}

export type DesktopAgentSessionMode = 'home' | 'workspace'

export interface DesktopAgentKnownProject {
  name: string
  path: string
}

export interface DesktopAgentStartSessionRequest extends DesktopAgentProviderRequest {
  directory?: string
  knownProjects?: DesktopAgentKnownProject[]
  mode?: DesktopAgentSessionMode
  projectRoot?: string
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
  presentation?: 'workspace_rerun' | 'workspace_continue' | 'workspace_parameter_update'
  schema_version: 'flow-agent.resolved_execution_contract.v1'
  title: string
}

export interface DesktopAgentWorkspaceContinueContract {
  continue_id: string
  rerun: false
  schema_version: 'flow-agent.workspace_continue_contract.v1'
  workspace: string
}

export type DesktopAgentWorkspaceSignoffAction = 'inspect' | 'export'

export interface DesktopAgentWorkspaceSignoffContract {
  action: DesktopAgentWorkspaceSignoffAction
  schema_version: 'flow-agent.workspace_signoff_contract.v1'
  signoff_id: string
  workspace: string
}

/**
 * Workspace files the Agent may write a parameter into. `home/parameters.json`
 * is authoritative; ECC regenerates the `config/*.json` step configs from it.
 */
export const desktopAgentParameterWriteFiles = [
  'home/parameters.json',
  'config/dreamplace.json',
  'config/cts_default_config.json',
  'config/rt_default_config.json',
] as const

export type DesktopAgentParameterWriteFile =
  (typeof desktopAgentParameterWriteFiles)[number]

export type DesktopAgentParameterWriteSurface = 'parameters' | 'step_config'

/**
 * A resolved write instruction. The Agent owns the knob-to-location mapping and
 * emits it with the contract, so the GUI executes rather than re-deriving it.
 */
export interface DesktopAgentWorkspaceParameterWrite {
  file: DesktopAgentParameterWriteFile
  json_path: (string | number)[]
  knob_id: string
  surface: DesktopAgentParameterWriteSurface
  value: DesktopAgentWorkspaceRerunParameterValue
}

export interface DesktopAgentWorkspaceParameterUpdateContract {
  parameter_patch: DesktopAgentWorkspaceRerunParameterPatch[]
  schema_version: 'flow-agent.workspace_parameter_update_contract.v2'
  update_id: string
  workspace: string
  writes: DesktopAgentWorkspaceParameterWrite[]
}

export interface DesktopAgentWorkspaceSetupParameters {
  clock: string
  design: string
  description: string
  die_area_mode: 'utilitization_margin' | 'width_height'
  die_height?: number
  die_width?: number
  frequency_max: number
  margin: number
  max_fanout: number
  target_density: number
  target_overflow: number
  top_module: string
  utilitization?: number
}

export interface DesktopAgentWorkspaceSetupContract {
  design_input_mode: 'rtl'
  directory: string
  filelist?: string
  flow_config: {
    end_step: string
    start_step: string
    steps: string[]
  }
  parameters: DesktopAgentWorkspaceSetupParameters
  pdk: 'ics55'
  pdk_config: {
    cell_lef: string[]
    liberty: string[]
    mode: 'default'
    tech_lef: string[]
  }
  pdk_config_mode: 'default'
  pdk_root: string
  project_context: {
    mode: 'create'
    project_json_path: string
    project_name: string
    project_root: string
  }
  requires_gui_review: true
  rtl_list: string[]
  schema_version: 'flow-agent.workspace_setup_contract.v2'
  setup_id: string
  sdc?: string
  title: string
  /** Whether the state machine selected SoC-MPC for this workspace. */
  mpc_enabled?: boolean
  /** Optional project-managed SoC-MPC snapshot selected by the GUI reviewer. */
  mpc?: import('../utils/projectManifest').ProjectManifestMpc | null
}

export type DesktopAgentWorkspaceRerunParameterValue =
  | boolean
  | number
  | string
  | number[]
  | string[]

export interface DesktopAgentWorkspaceRerunParameterPatch {
  knob_id: string
  value: DesktopAgentWorkspaceRerunParameterValue
}

export interface DesktopAgentWorkspaceRerunContract {
  design_id: string
  end_step: string
  execution_scope: 'single_step' | 'full_flow'
  parameter_patch: DesktopAgentWorkspaceRerunParameterPatch[]
  /** Optional only for pre-write-contract Agent providers; nonempty patches fail closed. */
  writes?: DesktopAgentWorkspaceParameterWrite[]
  requires_gui_review: true
  rerun_id: string
  schema_version: 'flow-agent.workspace_rerun_contract.v1'
  source_stage_artifact: string
  source_flow_json_sha256: string
  source_stage_artifact_sha256: string
  source_workspace: string
  target_step: string
  target_workspace: string
}

export interface DesktopAgentWorkspaceRerunPrepareResult {
  directory: string
  executionToken: string
}

export interface DesktopAgentWorkspaceRerunPrepareRequest {
  token: string
}

export interface DesktopAgentWorkspaceRerunExecuteRequest {
  token: string
}

export type DesktopAgentEventType =
  | 'status'
  | 'session'
  | 'message'
  | 'tool'
  | 'choice'
  | 'contract'
  | 'workspace_setup'
  | 'workspace_create'
  | 'workspace_rerun'
  | 'workspace_continue'
  | 'workspace_parameter_update'
  | 'workspace_signoff'
  | 'error'

export type DesktopAgentRunStatus =
  | 'idle'
  | 'running'
  | 'awaiting_choice'
  | 'interrupted'
  | 'error'

export interface DesktopAgentChoiceOption {
  id: string
  label: string
  value: string
}

export interface DesktopAgentChoice {
  promptId: string
  title: string
  options: DesktopAgentChoiceOption[]
  allowFreeText?: boolean
  variant: 'buttons' | 'list'
}

export interface DesktopAgentEvent {
  choice?: DesktopAgentChoice
  contract?: DesktopAgentExecutionContract
  delta?: string
  messageId?: string
  providerId?: string
  sessionId?: string
  status?: DesktopAgentRunStatus
  text?: string
  type: DesktopAgentEventType
  workspaceContinue?: DesktopAgentWorkspaceContinueContract
  workspaceCreateSetupId?: string
  workspaceParameterUpdate?: DesktopAgentWorkspaceParameterUpdateContract
  workspaceRerun?: DesktopAgentWorkspaceRerunContract
  workspaceRerunToken?: string
  workspaceSignoff?: DesktopAgentWorkspaceSignoffContract
  workspaceSetup?: DesktopAgentWorkspaceSetupContract
}
