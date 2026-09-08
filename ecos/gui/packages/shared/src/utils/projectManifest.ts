import type { PdkRequirement } from '../contracts/pdkInventory.ts'

export const projectManifestFlowSteps = [
  'Synth',
  'LEC',
  'Floor',
  'Place',
  'CTS',
  'Legal',
  'Timing Opt',
  'Route',
  'Filler',
  'RCX',
  'STA',
  'LVS',
  'Post-route LEC',
  'DRC',
  'Harden',
] as const

export type ProjectManifestFlowStep = (typeof projectManifestFlowSteps)[number]

export type ProjectManifestWorkspaceStatus =
  | 'success'
  | 'warning'
  | 'failed'
  | 'running'
  | 'in_progress'
  | 'not_started'
  | 'archived'

export interface ProjectManifestBaseDesign {
  filelist?: string
  pdk?: string
  pdk_root?: string
  pdk_requirement?: PdkRequirement
  sdc?: string
  top_module?: string
  clock?: string
  rtl_list?: string[]
  origin_verilog?: string
  origin_def?: string
  parameters?: Record<string, unknown>
}

export interface ProjectManifestMetricSummary {
  wns?: number
  tns?: number
  drc_count?: number
  lvs_count?: number
  area?: number
  runtime_sec?: number
  [key: string]: unknown
}

export interface ProjectManifestWorkspace {
  workspace_id: string
  name: string
  workspace_path: string
  source_workspace_id: string | null
  branch_from: {
    source_workspace_id: string
    source_step: ProjectManifestFlowStep | string
    source_output_type?: string
    source_output_path?: string
  } | null
  start_step: ProjectManifestFlowStep | string
  end_step: ProjectManifestFlowStep | string
  status: ProjectManifestWorkspaceStatus
  created_at: string
  updated_at: string
  parameter_patch: Record<string, unknown>
  metrics_summary: ProjectManifestMetricSummary
  step_metrics: Record<string, Record<string, unknown>>
}

export interface ProjectManifestMpc {
  resource_id: string
  display_name: string
  installed_version: string
  path: string
  spec_path: string
  design: ProjectManifestMpcDesign
  core_template: Record<string, unknown>
}

export interface ProjectManifestMpcDesign {
  index: number
  design_name: string
  directory?: string
}

export interface ProjectManifest {
  schema_version: 1
  project_id: string
  name: string
  design_name: string
  description: string
  root_path: string
  created_at: string
  updated_at: string
  base_design: ProjectManifestBaseDesign
  objectives: {
    primary: string
    directions: Record<string, 'maximize' | 'minimize'>
  }
  workspaces: ProjectManifestWorkspace[]
  mpc: ProjectManifestMpc | null
  best_workspace: {
    workspace_id: string
    reason: string
  } | null
  qor_baseline: {
    workspace_id: string
    reason: string
  } | null
}

export type EccProjectManifestWorkspace = ProjectManifestWorkspace
export type EccProjectManifest = ProjectManifest

export interface ProjectManifestWorkspaceRegistrationInput {
  projectRoot: string
  projectName?: string
  workspacePath: string
  sourceWorkspaceId?: string
  sourceStep?: ProjectManifestFlowStep | string
  sourceOutputPath?: string
  sourceOutputType?: string
  startStep?: ProjectManifestFlowStep | string
  endStep?: ProjectManifestFlowStep | string
  now?: string
  config?: {
    pdk?: string
    pdk_root?: string
    pdk_requirement?: PdkRequirement
    rtl_list?: string[]
    origin_verilog?: string
    origin_def?: string
    parameters?: Record<string, unknown>
  }
}

export interface ProjectManifestReplacementBackupInput {
  fallbackEndStep?: ProjectManifestFlowStep | string
  fallbackStartStep?: ProjectManifestFlowStep | string
  replacementId: string
}

export type ProjectManifestMutation =
  | {
      type: 'create'
      name: string
      designName: string
      mpc?: ProjectManifestMpc | null
    }
  | { input: ProjectManifestWorkspaceRegistrationInput; type: 'register-workspace' }
  | { type: 'archive-workspace'; workspaceId: string }
  | {
      deleteDirectory?: boolean
      type: 'delete-workspace'
      workspaceId: string
    }
  | { input: ProjectManifestReplacementBackupInput; type: 'record-replacement-backup' }
  | {
      type: 'select-qor-baseline'
      workspaceId: string
      reason?: string
    }

export interface ProjectManifestMutationRequest {
  mutation: ProjectManifestMutation
  projectRoot: string
}

export interface ProjectManifestMutationResult {
  cleanupPending?: boolean
  manifest: ProjectManifest
}

const FLOW_STEP_ALIASES: Record<string, ProjectManifestFlowStep> = {
  synthesis: 'Synth',
  synth: 'Synth',
  floorplan: 'Floor',
  floor: 'Floor',
  lec: 'LEC',
  place: 'Place',
  placement: 'Place',
  cts: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  timingoptimization: 'Timing Opt',
  route: 'Route',
  routing: 'Route',
  drc: 'DRC',
  lvs: 'LVS',
  filler: 'Filler',
  postlec: 'Post-route LEC',
  postroutelec: 'Post-route LEC',
  rcx: 'RCX',
  sta: 'STA',
  gds: 'Harden',
  signoff: 'Harden',
  harden: 'Harden',
}

export function projectIdFromName(name: string): string {
  return `proj_${slugify(name)}`
}

export function projectManifestForPresentation(
  source: EccProjectManifest,
  containingProjectRoot: string,
): ProjectManifest {
  const rootPath = normalizeProjectManifestPath(containingProjectRoot)
  if (!rootPath) throw new Error('Project root is required.')
  return {
    ...source,
    root_path: normalizeProjectManifestPath(rootPath),
    workspaces: source.workspaces.map((workspace) => ({
      ...workspace,
      workspace_path: resolveProjectManifestWorkspacePath(
        rootPath,
        workspace.workspace_path,
      ),
    })),
  }
}

export function normalizeProjectManifestFlowStep(
  step: ProjectManifestFlowStep | string,
): ProjectManifestFlowStep {
  return parseProjectManifestFlowStep(step) ?? 'Synth'
}

export function parseProjectManifestFlowStep(
  step: ProjectManifestFlowStep | string,
): ProjectManifestFlowStep | null {
  if ((projectManifestFlowSteps as readonly string[]).includes(step)) {
    return step as ProjectManifestFlowStep
  }
  return (
    FLOW_STEP_ALIASES[
      String(step)
        .toLowerCase()
        .replace(/[\s_-]/g, '')
    ] ?? null
  )
}

export function sameProjectManifestFlowStep(left: string, right: string): boolean {
  const canonical = parseProjectManifestFlowStep(left)
  return canonical !== null && canonical === parseProjectManifestFlowStep(right)
}

function normalizeProjectManifestPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.length <= 1) return normalized
  return normalized.replace(/\/+$/g, '')
}

function resolveProjectManifestWorkspacePath(
  projectRoot: string,
  workspacePath: string,
): string {
  const normalized = normalizeProjectManifestPath(workspacePath)
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return normalized
  }
  return normalizeProjectManifestPath(`${projectRoot}/${normalized}`)
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'project'
  )
}
