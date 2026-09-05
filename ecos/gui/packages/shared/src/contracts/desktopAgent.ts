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
  pendingInteraction?: DesktopAgentInteractionRequest
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

export type DesktopAgentReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface DesktopAgentModelOption {
  defaultReasoningEffort: DesktopAgentReasoningEffort
  displayName: string
  model: string
  supportedReasoningEfforts: DesktopAgentReasoningEffort[]
}

export interface DesktopAgentModelSettingsRequest extends DesktopAgentProviderRequest {
  sessionId: string
}

export interface DesktopAgentSetModelSettingsRequest extends DesktopAgentModelSettingsRequest {
  model?: string
  reasoningEffort?: DesktopAgentReasoningEffort
}

export interface DesktopAgentModelSettings {
  displayName: string
  model: string
  models: DesktopAgentModelOption[]
  reasoningEffort: DesktopAgentReasoningEffort
}

export type DesktopAgentInteractionPurpose = 'execution' | 'clarification'
export type DesktopAgentInteractionKind = 'choice' | 'confirm' | 'form'
export type DesktopAgentInteractionStatus =
  | 'pending'
  | 'answered'
  | 'cancelled'
  | 'expired'
  | 'superseded'

export interface DesktopAgentInteractionOption {
  id: string
  label: string
}

export interface DesktopAgentChoiceInteraction {
  kind: 'choice'
  options: DesktopAgentInteractionOption[]
  variant: 'buttons' | 'list'
}

export interface DesktopAgentConfirmInteraction {
  cancel: DesktopAgentInteractionOption
  confirm: DesktopAgentInteractionOption
  kind: 'confirm'
}

export interface DesktopAgentTextField {
  defaultValue?: string
  id: string
  kind: 'text'
  label: string
  required?: boolean
}

export interface DesktopAgentNumberField {
  defaultValue?: number
  id: string
  kind: 'number'
  label: string
  max?: number
  min?: number
  required?: boolean
}

export interface DesktopAgentPathField {
  defaultValue?: string
  extensions?: string[]
  id: string
  kind: 'path'
  label: string
  required?: boolean
}

export interface DesktopAgentSelectField {
  defaultValue?: string
  id: string
  kind: 'select'
  label: string
  options: DesktopAgentInteractionOption[]
  required?: boolean
}

export type DesktopAgentInteractionField =
  | DesktopAgentTextField
  | DesktopAgentNumberField
  | DesktopAgentPathField
  | DesktopAgentSelectField

export interface DesktopAgentFormInteraction {
  fields: DesktopAgentInteractionField[]
  kind: 'form'
}

export type DesktopAgentInteractionPayload =
  | DesktopAgentChoiceInteraction
  | DesktopAgentConfirmInteraction
  | DesktopAgentFormInteraction

export interface DesktopAgentInteractionRequest {
  canUndo?: boolean
  description?: string
  interaction: DesktopAgentInteractionPayload
  kind: DesktopAgentInteractionKind
  purpose: DesktopAgentInteractionPurpose
  requestId: string
  schema_version: 'flow-agent.interaction_request.v1'
  status: DesktopAgentInteractionStatus
  title: string
}

export type DesktopAgentInteractionAnswerRequest = DesktopAgentProviderRequest & {
  kind: DesktopAgentInteractionKind
  requestId: string
  sessionId: string
} & (
    | {
        undo: true
        optionId?: never
        text?: never
        values?: never
      }
    | {
        kind: 'choice' | 'confirm'
        undo?: never
        optionId: string
        text?: never
        values?: never
      }
    | {
        kind: 'choice' | 'confirm'
        undo?: never
        optionId?: never
        text: string
        values?: never
      }
    | {
        kind: 'form'
        undo?: never
        optionId?: never
        text?: never
        values: Record<string, string | number | null>
      }
  )

export interface DesktopAgentInteractionAnswerResponse {
  accepted: true
  canUndo?: boolean
  requestId: string
  sessionId: string
  undoneRequestId?: string
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
  pendingInteraction?: DesktopAgentInteractionRequest
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
 * Workspace files the Agent may write a parameter into. The workspace
 * configuration (`home/params.toml`, or `home/parameters.json` when that is
 * the on-disk format) is authoritative; ECC regenerates the `config/*.json`
 * step configs from it.
 */
export const desktopAgentParameterWriteFiles = [
  'home/params.toml',
  'home/parameters.json',
  'config/dreamplace_ecc.json',
  'config/cts_ecc.json',
  'config/route_ecc.json',
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
  | 'activity'
  | 'interaction'
  | 'unsupported_interaction'
  | 'contract'
  | 'workspace_setup'
  | 'workspace_create'
  | 'workspace_rerun'
  | 'workspace_continue'
  | 'workspace_parameter_update'
  | 'workspace_signoff'
  | 'optimization'
  | 'error'

export type DesktopAgentRunStatus =
  | 'idle'
  | 'running'
  | 'awaiting_interaction'
  | 'interrupted'
  | 'error'

export interface DesktopAgentOptimizationPayload {
  active_preserve_metrics?: string[]
  active_primary_metric?: string
  action?: { direction: string; knob_id: string } | null
  alignment_sha256?: string
  decisive_metric?: string | null
  episode_id: string
  execution_state?: string | null
  incumbent_candidate_root_ref?: string | null
  incumbent_decision?: string | null
  objective_sha256?: string
  original_objective?: Record<string, unknown>
  original_primary_metric?: string
  planning_state?: string | null
  primary_metric?: string
  proposal_decision?: string | null
  proposal_reason?: string | null
  rejection_reason?: string | null
  requested?: { knob_id: string; value: boolean | number } | null
  recovery_incomplete?: boolean
  recovery_stage?: string
  recovery_transition?: string | null
  schema_version: string
  state?: string
  turn_count?: number
  turn?: number
  workspace?: string
  violation_counts?: {
    drc_count: number
    sta_hold_violation_count: number
    sta_setup_violation_count: number
  }
}

export type DesktopAgentActivityStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'interrupted'

interface DesktopAgentActivityBase {
  durationMs?: number
  itemId: string
  schema_version: 'flow-agent.activity.v1'
  startedAt: number
  status: DesktopAgentActivityStatus
  turnId: string
  turnStartedAt: number
}

export interface DesktopAgentReasoningActivity extends DesktopAgentActivityBase {
  kind: 'reasoning_summary'
  summary: string[]
}

export interface DesktopAgentWebSearchAction {
  kind: 'search' | 'open_page' | 'find_in_page'
  query?: string
  title?: string
  url?: string
}

export interface DesktopAgentWebSearchActivity extends DesktopAgentActivityBase {
  actions: DesktopAgentWebSearchAction[]
  kind: 'web_search'
  query?: string
}

export interface DesktopAgentCommandActivity extends DesktopAgentActivityBase {
  command: string
  cwd?: string
  exitCode?: number
  kind: 'command_execution'
  label: string
  output?: string
  truncated?: boolean
}

export interface DesktopAgentToolCallActivity extends DesktopAgentActivityBase {
  arguments?: string
  error?: string
  kind: 'tool_call'
  progress?: string
  result?: string
  server?: string
  tool: string
  truncated?: boolean
}

export type DesktopAgentActivity =
  | DesktopAgentReasoningActivity
  | DesktopAgentWebSearchActivity
  | DesktopAgentCommandActivity
  | DesktopAgentToolCallActivity

export interface DesktopAgentActivityNotice {
  message: string
  schema_version: 'flow-agent.activity_notice.v1'
  turnId?: string
}

export interface DesktopAgentEvent {
  activity?: DesktopAgentActivity
  activityNotice?: DesktopAgentActivityNotice
  contract?: DesktopAgentExecutionContract
  delta?: string
  interaction?: DesktopAgentInteractionRequest
  messageId?: string
  optimization?: DesktopAgentOptimizationPayload
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
