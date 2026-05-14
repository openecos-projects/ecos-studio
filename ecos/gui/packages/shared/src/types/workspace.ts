export type WorkspaceStatus = 'success' | 'failed' | 'running' | 'in_progress' | 'not_started'

export interface WorkspaceSummary {
  id: string
  name: string
  path: string
  lastOpened: string
  workspaceRecognized?: boolean
  pdk?: string
  topModule?: string
  frequencyTarget?: number
  coreUtilization?: number
  status?: WorkspaceStatus
  totalSteps?: number
  completedSteps?: number
  currentStep?: string
  totalRuntime?: string
  cellCount?: number
  frequency?: number
}

export interface WorkspaceParameters {
  design: string
  description?: string
  top_module: string
  clock: string
  frequency_max: number
  core_utilization: number
  target_density: number
  max_fanout: number
}

export interface WorkspaceConfig {
  directory: string
  pdk: string
  pdk_root: string
  parameters: Partial<WorkspaceParameters> & Record<string, unknown>
  origin_def: string
  origin_verilog: string
  rtl_list: string[]
}
