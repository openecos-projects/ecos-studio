import type { PdkInstallationSnapshot } from './pdkInventory.ts'

export interface WorkspaceCreationModelRequest {
  explicitParameters?: Record<string, unknown>
  flowId?: string
  inputMode?: 'rtl' | 'postSynthesis'
  mpc?: Record<string, unknown> | null
  pdk?: {
    familyId: string
    mode: 'default' | 'manual'
    version?: string | null
  } | null
  projectPresetParameters?: Record<string, unknown>
}

export interface WorkspaceCreationParameter {
  definition: Record<string, unknown> & { id: string }
  state: 'explicit' | 'defaulted' | 'inapplicable'
  source?: 'catalogDefault' | 'projectPreset' | 'user'
  value?: unknown
  inapplicableReason?: string
}

export interface WorkspaceCreationModel {
  controls: {
    flowBoundaries: true
    manualPdkFiles: true
    mpc: true
    pdkVersion: true
  }
  discovery: Record<string, unknown>
  context: Pick<WorkspaceCreationModelRequest, 'flowId' | 'inputMode' | 'mpc' | 'pdk'>
  parameters: WorkspaceCreationParameter[]
  pdkInstallations: PdkInstallationSnapshot[]
}

export interface WorkspaceCreationModelApi {
  get(request?: WorkspaceCreationModelRequest): Promise<WorkspaceCreationModel>
}
