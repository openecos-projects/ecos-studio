import type { PdkRequirement } from '../contracts/pdkInventory.ts'
import {
  flowStepCanonicalIds,
  normalizeProjectManifestFlowStep,
} from './flowStepRegistry.ts'

export const projectManifestFlowSteps = flowStepCanonicalIds

export type ProjectManifestFlowStep = (typeof projectManifestFlowSteps)[number]

export const projectManifestFrontendFlowSteps = [
  'prepare',
  'review',
  'elab',
  'lint',
  'sim',
] as const

export type ProjectManifestFrontendFlowStep =
  (typeof projectManifestFrontendFlowSteps)[number]

export const projectManifestTypes = ['backend', 'frontend'] as const

export type ProjectManifestType = (typeof projectManifestTypes)[number]

export function isProjectManifestType(value: unknown): value is ProjectManifestType {
  return value === 'backend' || value === 'frontend'
}
export type ProjectManifestStage =
  | ProjectManifestFlowStep
  | ProjectManifestFrontendFlowStep

export interface ProjectManifestProfile {
  projectType: ProjectManifestType
  flowSteps: readonly ProjectManifestStage[]
  defaultStartStep: ProjectManifestStage
  defaultEndStep: ProjectManifestStage
}

const PROJECT_MANIFEST_PROFILES: Record<ProjectManifestType, ProjectManifestProfile> = {
  backend: {
    projectType: 'backend',
    flowSteps: projectManifestFlowSteps,
    defaultStartStep: 'Synth',
    defaultEndStep: 'Harden',
  },
  frontend: {
    projectType: 'frontend',
    flowSteps: projectManifestFrontendFlowSteps,
    defaultStartStep: 'prepare',
    defaultEndStep: 'sim',
  },
}

export function projectManifestProfileFor(
  projectType: ProjectManifestType,
): ProjectManifestProfile {
  return PROJECT_MANIFEST_PROFILES[projectType]
}

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
    source_step: ProjectManifestStage | string
    source_output_type?: string
    source_output_path?: string
  } | null
  start_step: ProjectManifestStage | string
  end_step: ProjectManifestStage | string
  status: ProjectManifestWorkspaceStatus
  created_at: string
  updated_at: string
  parameter_patch: Record<string, unknown>
  metrics_summary?: ProjectManifestMetricSummary
  step_metrics?: Record<string, Record<string, unknown>>
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
  project_type: ProjectManifestType
  project_id: string
  name: string
  design_name: string
  description: string
  root_path: string
  /** Presentation-only warnings for invalid registry entries ignored by the GUI. */
  runtime_process_issues?: string[]
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
  runtime_processes?: Record<string, ProjectRuntimeProcessEntry>
  /** Transient compatibility state; never persisted by ECC. */
  project_migration?: {
    status: 'legacy-readonly'
    reason: string
  }
}

export interface ProjectRuntimeProcessEntry {
  schema_version: 1
  run_id: string
  pid: number
  pgid: number
  process_start_id: string
  boot_id: string
  host_id: string
  workspace_path: string
  started_at: number
  runtime_id: string
  log_path: string
}

const RUNTIME_TOKEN = /^[A-Za-z0-9._:@+-]{1,128}$/
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function isProjectRuntimeProcessEntry(
  value: unknown,
): value is ProjectRuntimeProcessEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  return (
    entry.schema_version === 1 &&
    typeof entry.run_id === 'string' &&
    RUN_ID.test(entry.run_id) &&
    positiveSafeInteger(entry.pid) &&
    entry.pgid === entry.pid &&
    runtimeToken(entry.process_start_id) &&
    runtimeToken(entry.boot_id) &&
    runtimeToken(entry.host_id) &&
    safeWorkspacePath(entry.workspace_path) &&
    typeof entry.started_at === 'number' &&
    Number.isFinite(entry.started_at) &&
    entry.started_at > 0 &&
    runtimeToken(entry.runtime_id) &&
    entry.log_path === `log/${entry.run_id}.log`
  )
}

function projectRuntimeProcessProjection(value: unknown): {
  issues: string[]
  processes: Record<string, ProjectRuntimeProcessEntry>
} {
  if (value === undefined) return { issues: [], processes: {} }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { issues: ['Project runtime process registry is invalid.'], processes: {} }
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 4096) {
    return { issues: ['Project runtime process registry is too large.'], processes: {} }
  }
  const issues: string[] = []
  const processes: Record<string, ProjectRuntimeProcessEntry> = {}
  for (const [workspaceId, entry] of entries) {
    if (!runtimeToken(workspaceId) || !isProjectRuntimeProcessEntry(entry)) {
      issues.push(`Project runtime process entry is invalid: ${workspaceId}`)
      continue
    }
    processes[workspaceId] = entry
  }
  return { issues, processes }
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function runtimeToken(value: unknown): value is string {
  return typeof value === 'string' && RUNTIME_TOKEN.test(value)
}

function safeWorkspacePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    value.includes('\\')
  ) {
    return false
  }
  if (value.includes('\0')) return false
  const path = value.startsWith('/') ? value.slice(1) : value
  return (
    Boolean(path) &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

export type EccProjectManifestWorkspace = ProjectManifestWorkspace
export type EccProjectManifest = Omit<ProjectManifest, 'project_type'> & {
  project_type?: ProjectManifestType
}

export interface ProjectManifestWorkspaceRegistrationInput {
  projectRoot: string
  projectName?: string
  workspacePath: string
  sourceWorkspaceId?: string
  sourceStep?: ProjectManifestStage | string
  sourceOutputPath?: string
  sourceOutputType?: string
  startStep?: ProjectManifestStage | string
  endStep?: ProjectManifestStage | string
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
  fallbackEndStep?: ProjectManifestStage | string
  fallbackStartStep?: ProjectManifestStage | string
  replacementId: string
}

export interface ProjectManifestWorkspaceImportInput {
  projectRoot: string
  workspaceId?: string
  workspacePath: string
}

export type ProjectManifestMutation =
  | {
      type: 'create'
      name: string
      designName: string
      projectType?: ProjectManifestType
      mpc?: ProjectManifestMpc | null
    }
  | { input: ProjectManifestWorkspaceRegistrationInput; type: 'register-workspace' }
  | { input: ProjectManifestWorkspaceImportInput; type: 'import-workspace' }
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

export function projectIdFromName(name: string): string {
  return `proj_${slugify(name)}`
}

export function projectManifestForPresentation(
  source: EccProjectManifest,
  containingProjectRoot: string,
): ProjectManifest {
  const rootPath = normalizeProjectManifestPath(containingProjectRoot)
  if (!rootPath) throw new Error('Project root is required.')
  const projection = projectRuntimeProcessProjection(source.runtime_processes)
  const runtimeProcesses = { ...projection.processes }
  const workspaces = source.workspaces.map((workspace) => ({
    ...workspace,
    workspace_path: resolveProjectManifestWorkspacePath(
      rootPath,
      workspace.workspace_path,
    ),
  }))
  for (const [workspaceId, process] of Object.entries(runtimeProcesses)) {
    const workspace = workspaces.find(
      (candidate) => candidate.workspace_id === workspaceId,
    )
    const processWorkspacePath = resolveProjectManifestWorkspacePath(
      rootPath,
      process.workspace_path,
    )
    if (!workspace || workspace.workspace_path !== processWorkspacePath) {
      projection.issues.push(
        `Project runtime process Workspace does not match: ${workspaceId}`,
      )
      delete runtimeProcesses[workspaceId]
    }
  }
  return {
    ...source,
    project_type: source.project_type ?? 'backend',
    runtime_processes: runtimeProcesses,
    ...(projection.issues.length ? { runtime_process_issues: projection.issues } : {}),
    root_path: normalizeProjectManifestPath(rootPath),
    workspaces,
  }
}

export {
  normalizeProjectManifestFlowStep,
  parseProjectManifestFlowStep,
  sameProjectManifestFlowStep,
} from './flowStepRegistry.ts'

export function normalizeProjectManifestStage(
  projectType: ProjectManifestType,
  step: ProjectManifestStage | string,
): ProjectManifestStage {
  if (projectType === 'backend') return normalizeProjectManifestFlowStep(step)
  const normalized = String(step).trim().toLowerCase()
  return (projectManifestFrontendFlowSteps as readonly string[]).includes(normalized)
    ? (normalized as ProjectManifestFrontendFlowStep)
    : 'prepare'
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
