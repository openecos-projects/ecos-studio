import type { ProjectManifestMpc } from '../utils/projectManifest'

export type WorkspaceStatus =
  | 'success'
  | 'failed'
  | 'running'
  | 'in_progress'
  | 'not_started'

export type DesignTool = 'backend' | 'frontend'

export interface WorkspaceSummary {
  id: string
  name: string
  path: string
  lastOpened: string
  designTool?: DesignTool
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
  die_area_mode?: 'width_height' | 'utilitization_margin'
  die_width?: number
  die_height?: number
  utilitization?: number
  margin?: number
}

export interface WorkspaceConfig {
  directory: string
  designTool?: DesignTool
  cpu_rtl_files?: string[]
  pdk: string
  pdk_root: string
  parameters: Partial<WorkspaceParameters> & Record<string, unknown>
  origin_def: string
  origin_verilog: string
  rtl_list: string[]
  filelist?: string
  design_input_mode?: 'rtl' | 'post_synthesis'
  sdc?: string
  pdk_config_mode?: 'default' | 'manual'
  flow_config?: {
    start_step: string
    end_step: string
    steps: string[]
  }
  pdk_config?: {
    mode?: 'default' | 'manual'
    tech_lef: string[]
    cell_lef: string[]
    liberty: string[]
  }
  pdk_json?: string
  mpc?: ProjectManifestMpc | null
  replaceExistingWorkspace?: boolean
  keepReplacementBackup?: boolean
  project_context?: {
    mode: 'select' | 'create'
    project_name: string
    project_root: string
    project_json_path: string
  }
  source_context?: {
    projectName?: string
    projectRoot?: string
    workspaceId?: string
    workspaceName?: string
    workspacePath?: string
    step?: string
    outputPath?: string
    outputType?: string
    startStep?: string
  }
  source_config?: Partial<WorkspaceConfig>
}
