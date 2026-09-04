import type { PdkRequirement } from '../contracts/pdkInventory.ts'

export const projectManifestFlowSteps = [
  'Synth',
  'Floor',
  'Place',
  'CTS',
  'Legal',
  'Route',
  'DRC',
  'LVS',
  'Filler',
  'RCX',
  'STA',
  'Harden',
] as const

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
  | 'failed'
  | 'running'
  | 'in_progress'
  | 'not_started'
  | 'archived'

export interface ProjectManifestBaseDesign {
  pdk?: string
  pdk_root?: string
  pdk_requirement?: PdkRequirement
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

export interface ProjectManifestDraftInput {
  rootPath: string
  name: string
  designName: string
  projectType?: ProjectManifestType
  mpc?: ProjectManifestMpc | null
  now?: string
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

export interface ProjectManifestResolvedReplacementBackupInput {
  backupPath: string
  fallbackEndStep?: ProjectManifestStage | string
  fallbackStartStep?: ProjectManifestStage | string
  targetPath: string
}

export interface ProjectManifestBaselineSyncInput {
  workspaceId: string
  baseDesign: ProjectManifestBaseDesign
  reason?: string
  now?: string
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
  content: string
}

const FLOW_STEP_ALIASES: Record<string, ProjectManifestFlowStep> = {
  synthesis: 'Synth',
  synth: 'Synth',
  floorplan: 'Floor',
  floor: 'Floor',
  fanout: 'Floor',
  fixfanout: 'Floor',
  place: 'Place',
  placement: 'Place',
  cts: 'CTS',
  legalization: 'Legal',
  legal: 'Legal',
  // Timing Opt runs between Legal and Route; keep the coarse boundary at the
  // preceding catalog step so branching from it starts at Route.
  timingopt: 'Legal',
  timingoptimization: 'Legal',
  route: 'Route',
  routing: 'Route',
  drc: 'DRC',
  lvs: 'LVS',
  filler: 'Filler',
  // postRouteLec runs between Filler and RCX; same preceding-step rationale.
  postlec: 'Filler',
  postroutelec: 'Filler',
  rcx: 'RCX',
  sta: 'STA',
  gds: 'Harden',
  signoff: 'Harden',
  harden: 'Harden',
}

const FRONTEND_FLOW_STEP_ALIASES: Record<string, ProjectManifestFrontendFlowStep> = {
  prepare: 'prepare',
  review: 'review',
  rtlreview: 'review',
  rtl_review: 'review',
  elab: 'elab',
  elaborate: 'elab',
  lint: 'lint',
  sim: 'sim',
  simulation: 'sim',
}

const PROJECT_MANIFEST_WORKSPACE_STATUSES = new Set<ProjectManifestWorkspaceStatus>([
  'success',
  'failed',
  'running',
  'in_progress',
  'not_started',
  'archived',
])

export function createProjectManifestDraft(
  input: ProjectManifestDraftInput,
): ProjectManifest {
  const now = input.now ?? new Date().toISOString()
  const projectType = normalizeProjectManifestType(input.projectType)
  const rootPath = normalizeProjectManifestPath(input.rootPath)
  const name =
    optionalString(input.name) || basenameProjectManifestPath(rootPath) || 'project'
  const designName = optionalString(input.designName)
  if (!designName) throw new Error('Project manifest design_name is required.')
  return {
    schema_version: 1,
    project_type: projectType,
    project_id: projectIdFromName(name),
    name,
    design_name: designName,
    description: '',
    root_path: rootPath,
    created_at: now,
    updated_at: now,
    base_design: {
      parameters: { design: designName },
      rtl_list: [],
    },
    objectives: defaultProjectObjectives(projectType),
    workspaces: [],
    mpc: normalizeProjectManifestMpc(input.mpc),
    best_workspace: null,
    qor_baseline: null,
  }
}

export function projectIdFromName(name: string): string {
  return `proj_${slugify(name)}`
}

export function serializeProjectManifest(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function parseProjectManifest(content: string): ProjectManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    const manifestError = new Error('Invalid project manifest JSON.')
    Object.assign(manifestError, { cause: error })
    throw manifestError
  }

  const source = recordValue(parsed)
  if (!source || source.schema_version !== 1 || !Array.isArray(source.workspaces)) {
    throw new Error(
      'Invalid project manifest: schema_version 1 and workspaces are required.',
    )
  }

  const rootPath = optionalString(source.root_path)
  if (!rootPath) throw new Error('Invalid project manifest: root_path is required.')
  const designName = optionalString(source.design_name)
  if (!designName) throw new Error('Invalid project manifest: design_name is required.')

  const name =
    optionalString(source.name) || basenameProjectManifestPath(rootPath) || 'project'
  const projectType = normalizeProjectManifestType(source.project_type)
  const createdAt = optionalString(source.created_at) || new Date(0).toISOString()
  const updatedAt = optionalString(source.updated_at) || createdAt
  const baseDesign = normalizeBaseDesign(source.base_design)
  const objectives = normalizeObjectives(source.objectives, projectType)

  return {
    ...source,
    schema_version: 1,
    project_type: projectType,
    project_id: optionalString(source.project_id) || `proj_${slugify(name)}`,
    name,
    design_name: designName,
    description: optionalString(source.description),
    root_path: normalizeProjectManifestPath(rootPath),
    created_at: createdAt,
    updated_at: updatedAt,
    base_design: withProjectDesignName(baseDesign, designName),
    objectives,
    workspaces: source.workspaces.map((workspace, index) =>
      normalizeWorkspace(workspace, index, createdAt, projectType),
    ),
    mpc: normalizeProjectManifestMpc(source.mpc),
    best_workspace: normalizeBestWorkspace(source.best_workspace),
    qor_baseline:
      projectType === 'backend' ? normalizeQorBaseline(source.qor_baseline) : null,
  }
}

export function applyProjectManifestMutation(
  currentManifest: ProjectManifest | null,
  projectRoot: string,
  mutation: ProjectManifestMutation,
): ProjectManifest {
  switch (mutation.type) {
    case 'create':
      return createProjectManifestDraft({
        name: mutation.name,
        designName: mutation.designName,
        rootPath: projectRoot,
        projectType: mutation.projectType,
        mpc: mutation.mpc,
      })
    case 'register-workspace': {
      const manifest = requireManifest(currentManifest)
      return registerWorkspaceInManifest(manifest, {
        ...mutation.input,
        projectRoot,
      })
    }
    case 'archive-workspace':
      return archiveWorkspaceInManifest(
        requireManifest(currentManifest),
        mutation.workspaceId,
      )
    case 'delete-workspace':
      return deleteWorkspaceFromManifest(
        requireManifest(currentManifest),
        mutation.workspaceId,
      )
    case 'record-replacement-backup':
      throw new Error(
        'Replacement backup mutations must be resolved by the desktop manifest service.',
      )
    case 'select-qor-baseline':
      throw new Error(
        'QoR baseline mutations must be resolved by the desktop manifest service.',
      )
  }
}

export function registerWorkspaceInManifest(
  manifest: ProjectManifest,
  input: ProjectManifestWorkspaceRegistrationInput,
): ProjectManifest {
  const now = input.now ?? new Date().toISOString()
  const profile = projectManifestProfileFor(manifest.project_type)
  const workspacePath = normalizeProjectManifestPath(input.workspacePath)
  const workspaceId =
    basenameProjectManifestPath(workspacePath) || nextManifestWorkspaceId(manifest)
  const existingWorkspace = manifest.workspaces.find(
    (workspace) =>
      workspace.workspace_id === workspaceId ||
      normalizeProjectManifestPath(workspace.workspace_path) === workspacePath,
  )
  const sourceStep = input.sourceStep
    ? normalizeProjectManifestStage(manifest.project_type, input.sourceStep)
    : null
  const sourceWorkspaceId =
    input.sourceWorkspaceId || existingWorkspace?.source_workspace_id || null
  const branchFrom =
    sourceWorkspaceId && sourceStep
      ? {
          source_workspace_id: sourceWorkspaceId,
          source_step: sourceStep,
          source_output_type:
            input.sourceOutputType ||
            existingWorkspace?.branch_from?.source_output_type ||
            defaultSourceOutputType(manifest.project_type, sourceStep),
          source_output_path:
            input.sourceOutputPath || existingWorkspace?.branch_from?.source_output_path,
        }
      : (existingWorkspace?.branch_from ?? null)
  const startStep = input.startStep
    ? normalizeProjectManifestStage(manifest.project_type, input.startStep)
    : sourceStep
      ? nextProjectManifestStage(manifest.project_type, sourceStep)
      : normalizeProjectManifestStage(
          manifest.project_type,
          existingWorkspace?.start_step ?? profile.defaultStartStep,
        )
  const endStep = input.endStep
    ? normalizeProjectManifestStage(manifest.project_type, input.endStep)
    : normalizeProjectManifestStage(
        manifest.project_type,
        existingWorkspace?.end_step ?? profile.defaultEndStep,
      )
  const workspaceName = manifest.design_name
  const workspaceParameters = {
    ...input.config?.parameters,
    design: manifest.design_name,
  }
  const parameterPatch = input.config
    ? {
        ...existingWorkspace?.parameter_patch,
        ...buildParameterPatch(
          manifest.base_design.parameters ?? {},
          workspaceParameters,
        ),
      }
    : { ...existingWorkspace?.parameter_patch }
  const workspace: ProjectManifestWorkspace = {
    ...existingWorkspace,
    workspace_id: workspaceId,
    name: workspaceName,
    workspace_path: workspacePath,
    source_workspace_id: sourceWorkspaceId,
    branch_from: branchFrom,
    start_step: startStep,
    end_step: endStep,
    status: existingWorkspace?.status ?? 'not_started',
    created_at: existingWorkspace?.created_at ?? now,
    updated_at: now,
    parameter_patch: parameterPatch,
    ...(existingWorkspace?.metrics_summary
      ? { metrics_summary: existingWorkspace.metrics_summary }
      : {}),
    ...(existingWorkspace?.step_metrics
      ? { step_metrics: existingWorkspace.step_metrics }
      : {}),
  }
  const workspaces = existingWorkspace
    ? manifest.workspaces.map((item) =>
        item.workspace_id === existingWorkspace.workspace_id ? workspace : item,
      )
    : [...manifest.workspaces, workspace]
  const qorBaseline =
    manifest.project_type === 'backend'
      ? ensureProjectQorBaseline(manifest.qor_baseline, workspaces)
      : null
  const shouldSyncBaseDesign =
    manifest.project_type === 'backend'
      ? manifest.qor_baseline === null ||
        manifest.qor_baseline.workspace_id === workspaceId
      : manifest.workspaces[0]?.workspace_id === workspaceId ||
        manifest.workspaces.length === 0

  return {
    ...manifest,
    name: input.projectName || manifest.name,
    root_path: normalizeProjectManifestPath(input.projectRoot || manifest.root_path),
    updated_at: now,
    base_design: shouldSyncBaseDesign
      ? withProjectDesignName(
          mergeBaseDesignConfig(manifest.base_design, {
            ...input.config,
            parameters: workspaceParameters,
          }),
          manifest.design_name,
        )
      : withProjectDesignName(manifest.base_design, manifest.design_name),
    workspaces,
    qor_baseline: qorBaseline,
  }
}

export function synchronizeProjectBaseline(
  manifest: ProjectManifest,
  input: ProjectManifestBaselineSyncInput,
): ProjectManifest {
  if (manifest.project_type !== 'backend') {
    throw new Error('QoR baselines are only available for backend projects.')
  }
  const workspace = manifest.workspaces.find(
    (candidate) =>
      candidate.workspace_id === input.workspaceId && candidate.status !== 'archived',
  )
  if (!workspace) {
    throw new Error(
      `Workspace ${input.workspaceId} is not available for the project QoR baseline.`,
    )
  }

  return {
    ...manifest,
    updated_at: input.now ?? new Date().toISOString(),
    base_design: withProjectDesignName(input.baseDesign, manifest.design_name),
    qor_baseline: {
      workspace_id: workspace.workspace_id,
      reason: input.reason || 'Selected from Project QoR Trend',
    },
  }
}

export function archiveWorkspaceInManifest(
  manifest: ProjectManifest,
  workspaceId: string,
  now = new Date().toISOString(),
): ProjectManifest {
  const workspaces = manifest.workspaces.map((workspace) =>
    workspace.workspace_id === workspaceId
      ? { ...workspace, status: 'archived' as const, updated_at: now }
      : workspace,
  )
  return {
    ...manifest,
    updated_at: now,
    best_workspace:
      manifest.best_workspace?.workspace_id === workspaceId
        ? null
        : manifest.best_workspace,
    qor_baseline:
      manifest.project_type === 'backend'
        ? ensureProjectQorBaseline(manifest.qor_baseline, workspaces)
        : null,
    workspaces,
  }
}

export function deleteWorkspaceFromManifest(
  manifest: ProjectManifest,
  workspaceId: string,
  now = new Date().toISOString(),
): ProjectManifest {
  const workspaces = manifest.workspaces
    .filter((workspace) => workspace.workspace_id !== workspaceId)
    .map((workspace) => {
      const clearsSource =
        workspace.source_workspace_id === workspaceId ||
        workspace.branch_from?.source_workspace_id === workspaceId
      if (!clearsSource) return workspace
      return {
        ...workspace,
        source_workspace_id:
          workspace.source_workspace_id === workspaceId
            ? null
            : workspace.source_workspace_id,
        branch_from:
          workspace.branch_from?.source_workspace_id === workspaceId
            ? null
            : workspace.branch_from,
        updated_at: now,
      }
    })
  return {
    ...manifest,
    updated_at: now,
    best_workspace:
      manifest.best_workspace?.workspace_id === workspaceId
        ? null
        : manifest.best_workspace,
    qor_baseline:
      manifest.project_type === 'backend'
        ? ensureProjectQorBaseline(manifest.qor_baseline, workspaces)
        : null,
    workspaces,
  }
}

export function setQorBaselineInManifest(
  manifest: ProjectManifest,
  workspaceId: string,
  reason = 'Selected from Project QoR Trend',
  now = new Date().toISOString(),
): ProjectManifest {
  if (manifest.project_type !== 'backend') return manifest
  const hasWorkspace = manifest.workspaces.some(
    (workspace) =>
      workspace.workspace_id === workspaceId && workspace.status !== 'archived',
  )
  if (!hasWorkspace) return manifest

  return {
    ...manifest,
    updated_at: now,
    qor_baseline: {
      workspace_id: workspaceId,
      reason,
    },
  }
}

export function recordReplacementBackupInManifest(
  manifest: ProjectManifest,
  input: ProjectManifestResolvedReplacementBackupInput,
): ProjectManifest {
  const now = new Date().toISOString()
  const profile = projectManifestProfileFor(manifest.project_type)
  const backupPath = normalizeProjectManifestPath(input.backupPath)
  const targetPath = normalizeProjectManifestPath(input.targetPath)
  const backupWorkspaceId = basenameProjectManifestPath(backupPath)
  const replacedWorkspaceId = basenameProjectManifestPath(targetPath)
  if (!backupWorkspaceId || !replacedWorkspaceId) {
    throw new Error('Invalid workspace replacement backup paths.')
  }

  const existingBackup = manifest.workspaces.find(
    (workspace) =>
      workspace.workspace_id === backupWorkspaceId ||
      normalizeProjectManifestPath(workspace.workspace_path) === backupPath,
  )
  const replacedWorkspace = manifest.workspaces.find(
    (workspace) =>
      workspace.workspace_id === replacedWorkspaceId ||
      normalizeProjectManifestPath(workspace.workspace_path) === targetPath,
  )
  const backupWorkspace: ProjectManifestWorkspace = {
    ...replacedWorkspace,
    ...existingBackup,
    workspace_id: backupWorkspaceId,
    name: `${replacedWorkspace?.name || replacedWorkspaceId} backup`,
    workspace_path: backupPath,
    source_workspace_id: replacedWorkspace?.source_workspace_id ?? null,
    branch_from: replacedWorkspace?.branch_from ?? null,
    start_step:
      replacedWorkspace?.start_step ||
      input.fallbackStartStep ||
      profile.defaultStartStep,
    end_step:
      replacedWorkspace?.end_step || input.fallbackEndStep || profile.defaultEndStep,
    status: 'archived',
    created_at: existingBackup?.created_at ?? now,
    updated_at: now,
    parameter_patch: replacedWorkspace?.parameter_patch ?? {},
    ...(existingBackup?.metrics_summary || replacedWorkspace?.metrics_summary
      ? {
          metrics_summary:
            existingBackup?.metrics_summary ?? replacedWorkspace?.metrics_summary,
        }
      : {}),
    ...(existingBackup?.step_metrics || replacedWorkspace?.step_metrics
      ? {
          step_metrics: existingBackup?.step_metrics ?? replacedWorkspace?.step_metrics,
        }
      : {}),
  }
  return {
    ...manifest,
    updated_at: now,
    workspaces: existingBackup
      ? manifest.workspaces.map((workspace) =>
          workspace.workspace_id === existingBackup.workspace_id
            ? backupWorkspace
            : workspace,
        )
      : [...manifest.workspaces, backupWorkspace],
  }
}

export function normalizeProjectManifestFlowStep(
  step: ProjectManifestFlowStep | string,
): ProjectManifestFlowStep {
  if ((projectManifestFlowSteps as readonly string[]).includes(step)) {
    return step as ProjectManifestFlowStep
  }
  return (
    FLOW_STEP_ALIASES[
      String(step)
        .toLowerCase()
        .replace(/[_\-\s]+/g, '')
    ] ?? 'Synth'
  )
}

export function normalizeProjectManifestStage(
  projectType: ProjectManifestType,
  step: ProjectManifestStage | string,
): ProjectManifestStage {
  if (projectType === 'backend') return normalizeProjectManifestFlowStep(step)
  return (
    FRONTEND_FLOW_STEP_ALIASES[String(step).trim().toLowerCase()] ??
    projectManifestProfileFor(projectType).defaultStartStep
  )
}

export function nextProjectManifestStage(
  projectType: ProjectManifestType,
  step: ProjectManifestStage | string,
): ProjectManifestStage {
  const profile = projectManifestProfileFor(projectType)
  const normalized = normalizeProjectManifestStage(projectType, step)
  const index = profile.flowSteps.indexOf(normalized)
  return profile.flowSteps[
    Math.min(Math.max(index, 0) + 1, profile.flowSteps.length - 1)
  ]!
}

function normalizeWorkspace(
  value: unknown,
  index: number,
  fallbackTimestamp: string,
  projectType: ProjectManifestType,
): ProjectManifestWorkspace {
  const source = recordValue(value)
  if (!source)
    throw new Error(`Invalid project manifest: workspaces[${index}] must be an object.`)
  const workspaceId = optionalString(source.workspace_id)
  const workspacePath = optionalString(source.workspace_path)
  if (!workspaceId || !workspacePath) {
    throw new Error(
      `Invalid project manifest: workspaces[${index}] requires workspace_id and workspace_path.`,
    )
  }
  const branch = recordValue(source.branch_from)
  const sourceWorkspaceId = optionalString(source.source_workspace_id) || null
  const profile = projectManifestProfileFor(projectType)
  const metricsSummary = recordValue(source.metrics_summary)
  const stepMetrics = recordValue(source.step_metrics)
  return {
    ...source,
    workspace_id: workspaceId,
    name: optionalString(source.name) || workspaceId,
    workspace_path: normalizeProjectManifestPath(workspacePath),
    source_workspace_id: sourceWorkspaceId,
    branch_from:
      branch && optionalString(branch.source_workspace_id)
        ? {
            ...branch,
            source_workspace_id: optionalString(branch.source_workspace_id),
            source_step: optionalString(branch.source_step) || profile.defaultStartStep,
            ...(optionalString(branch.source_output_type)
              ? { source_output_type: optionalString(branch.source_output_type) }
              : {}),
            ...(optionalString(branch.source_output_path)
              ? { source_output_path: optionalString(branch.source_output_path) }
              : {}),
          }
        : null,
    start_step: optionalString(source.start_step) || profile.defaultStartStep,
    end_step: optionalString(source.end_step) || profile.defaultEndStep,
    status: normalizeWorkspaceStatus(source.status),
    created_at: optionalString(source.created_at) || fallbackTimestamp,
    updated_at: optionalString(source.updated_at) || fallbackTimestamp,
    parameter_patch: recordValue(source.parameter_patch) ?? {},
    ...(metricsSummary ? { metrics_summary: metricsSummary } : {}),
    ...(stepMetrics ? { step_metrics: normalizeStepMetrics(stepMetrics) } : {}),
  }
}

function normalizeProjectManifestMpc(value: unknown): ProjectManifestMpc | null {
  if (value === undefined || value === null) return null
  const source = recordValue(value)
  if (!source) {
    throw new Error('Invalid project manifest: mpc must be an object or null.')
  }

  const resourceId = optionalString(source.resource_id)
  const displayName = optionalString(source.display_name)
  const installedVersion = optionalString(source.installed_version)
  const mpcPath = optionalString(source.path)
  const specPath = optionalString(source.spec_path)
  const design = recordValue(source.design)
  const coreTemplate = recordValue(source.core_template)
  if (!resourceId || !resourceId.startsWith('mpc:') || resourceId.length === 4) {
    throw new Error(
      'Invalid project manifest: mpc.resource_id must be an MPC resource id.',
    )
  }
  if (!displayName || !installedVersion || !mpcPath || !specPath) {
    throw new Error(
      'Invalid project manifest: mpc requires display_name, installed_version, path, and spec_path.',
    )
  }

  const normalizedPath = normalizeProjectManifestPath(mpcPath)
  const normalizedSpecPath = normalizeProjectManifestPath(specPath)
  const expectedSpecPath = `${normalizedPath}/spec/spec.json.in`
  if (normalizedSpecPath !== expectedSpecPath) {
    throw new Error(
      'Invalid project manifest: mpc.spec_path must reference spec/spec.json.in below mpc.path.',
    )
  }
  if (
    !design ||
    !Number.isInteger(design.index) ||
    (design.index as number) < 0 ||
    !optionalString(design.design_name)
  ) {
    throw new Error(
      'Invalid project manifest: mpc.design requires a non-negative index and design_name.',
    )
  }
  if (!coreTemplate) {
    throw new Error('Invalid project manifest: mpc.core_template must be an object.')
  }

  return {
    resource_id: resourceId,
    display_name: displayName,
    installed_version: installedVersion,
    path: normalizedPath,
    spec_path: normalizedSpecPath,
    design: {
      index: design.index as number,
      design_name: optionalString(design.design_name),
      ...(optionalString(design.directory)
        ? { directory: optionalString(design.directory) }
        : {}),
    },
    core_template: coreTemplate,
  }
}

function normalizeBaseDesign(value: unknown): ProjectManifestBaseDesign {
  const source = recordValue(value) ?? {}
  const pdkRequirement = normalizePdkRequirement(source.pdk_requirement)
  return {
    ...source,
    ...(optionalString(source.pdk) ? { pdk: optionalString(source.pdk) } : {}),
    ...(optionalString(source.pdk_root)
      ? { pdk_root: optionalString(source.pdk_root) }
      : {}),
    ...(pdkRequirement ? { pdk_requirement: pdkRequirement } : {}),
    ...(optionalString(source.top_module)
      ? { top_module: optionalString(source.top_module) }
      : {}),
    ...(optionalString(source.clock) ? { clock: optionalString(source.clock) } : {}),
    ...(Array.isArray(source.rtl_list)
      ? {
          rtl_list: source.rtl_list.filter(
            (item): item is string => typeof item === 'string',
          ),
        }
      : { rtl_list: [] }),
    ...(optionalString(source.origin_verilog)
      ? { origin_verilog: optionalString(source.origin_verilog) }
      : {}),
    ...(optionalString(source.origin_def)
      ? { origin_def: optionalString(source.origin_def) }
      : {}),
    parameters: recordValue(source.parameters) ?? {},
  }
}

function normalizeObjectives(
  value: unknown,
  projectType: ProjectManifestType,
): ProjectManifest['objectives'] {
  const source = recordValue(value) ?? {}
  const directions = recordValue(source.directions) ?? {}
  const defaults = defaultProjectObjectives(projectType)
  return {
    ...source,
    primary: optionalString(source.primary) || defaults.primary,
    directions: Object.fromEntries(
      Object.entries(directions).flatMap(([key, direction]) =>
        direction === 'maximize' || direction === 'minimize' ? [[key, direction]] : [],
      ),
    ),
  }
}

function defaultProjectObjectives(
  projectType: ProjectManifestType,
): ProjectManifest['objectives'] {
  if (projectType === 'frontend') {
    return {
      primary: 'verification',
      directions: {
        errors: 'minimize',
        warnings: 'minimize',
        failed_cases: 'minimize',
        pass_rate: 'maximize',
        cycles: 'minimize',
      },
    }
  }
  return {
    primary: 'timing',
    directions: {
      wns: 'maximize',
      tns: 'maximize',
      area: 'minimize',
      drc_count: 'minimize',
      lvs_count: 'minimize',
      power: 'minimize',
    },
  }
}

function normalizeProjectManifestType(value: unknown): ProjectManifestType {
  if (value === undefined || value === null || value === '') return 'backend'
  if (value === 'backend' || value === 'frontend') return value
  throw new Error('Invalid project manifest: project_type must be backend or frontend.')
}

function normalizeBestWorkspace(value: unknown): ProjectManifest['best_workspace'] {
  const source = recordValue(value)
  const workspaceId = optionalString(source?.workspace_id)
  if (!workspaceId) return null
  return { workspace_id: workspaceId, reason: optionalString(source?.reason) }
}

function normalizeQorBaseline(value: unknown): ProjectManifest['qor_baseline'] {
  if (value === undefined || value === null) return null
  const source = recordValue(value)
  const workspaceId = optionalString(source?.workspace_id)
  if (!workspaceId) return null
  return {
    workspace_id: workspaceId,
    reason: optionalString(source?.reason) || 'Project QoR baseline',
  }
}

export function ensureProjectQorBaseline(
  baseline: ProjectManifest['qor_baseline'],
  workspaces: readonly { workspace_id: string; status: string }[],
): ProjectManifest['qor_baseline'] {
  const hasAvailableBaseline = Boolean(
    baseline &&
    workspaces.some(
      (workspace) =>
        workspace.workspace_id === baseline.workspace_id &&
        workspace.status !== 'archived',
    ),
  )
  if (hasAvailableBaseline) return baseline

  const workspace = workspaces.find((item) => item.status !== 'archived')
  return workspace
    ? { workspace_id: workspace.workspace_id, reason: 'Default project QoR baseline' }
    : null
}

function normalizeStepMetrics(value: unknown): Record<string, Record<string, unknown>> {
  const source = recordValue(value) ?? {}
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, metrics]) => {
      const record = recordValue(metrics)
      return record ? [[key, record]] : []
    }),
  )
}

function normalizeWorkspaceStatus(value: unknown): ProjectManifestWorkspaceStatus {
  return typeof value === 'string' &&
    PROJECT_MANIFEST_WORKSPACE_STATUSES.has(value as never)
    ? (value as ProjectManifestWorkspaceStatus)
    : 'not_started'
}

function requireManifest(manifest: ProjectManifest | null): ProjectManifest {
  if (!manifest) throw new Error('Project manifest does not exist.')
  return manifest
}

function nextManifestWorkspaceId(manifest: ProjectManifest): string {
  const numbers = manifest.workspaces
    .map((workspace) => Number(workspace.workspace_id.replace(/^ws_/, '')))
    .filter(Number.isFinite)
  const next = Math.max(0, ...numbers) + 1
  return `ws_${String(next).padStart(4, '0')}`
}

function mergeBaseDesignConfig(
  baseDesign: ProjectManifestBaseDesign,
  config: ProjectManifestWorkspaceRegistrationInput['config'],
): ProjectManifestBaseDesign {
  if (!config) return baseDesign
  const parameters = config.parameters ?? {}
  const next: ProjectManifestBaseDesign = {
    ...baseDesign,
    parameters: {
      ...baseDesign.parameters,
      ...parameters,
    },
  }
  const pdk = optionalString(config.pdk)
  const pdkRoot = optionalString(config.pdk_root)
  const topModule = optionalString(parameters.top_module)
  const clock = optionalString(parameters.clock)
  const originVerilog = optionalString(config.origin_verilog)
  const originDef = optionalString(config.origin_def)
  if (pdk) next.pdk = pdk
  if (pdkRoot) next.pdk_root = pdkRoot
  if (config.pdk_requirement) {
    next.pdk_requirement = config.pdk_requirement
    delete next.pdk_root
  }
  if (topModule) next.top_module = topModule
  if (clock) next.clock = clock
  if (originVerilog) next.origin_verilog = originVerilog
  if (originDef) next.origin_def = originDef
  if (config.rtl_list && config.rtl_list.length > 0) next.rtl_list = [...config.rtl_list]
  return next
}

function normalizePdkRequirement(value: unknown): PdkRequirement | null {
  const record = recordValue(value)
  if (!record) return null
  const familyId = optionalString(record.familyId)
  if (!familyId) return null
  const manual = recordValue(record.manualConfig)
  return {
    familyId,
    version: optionalString(record.version) || null,
    manualConfig: manual
      ? {
          techLef: optionalString(manual.techLef),
          cellLefs: Array.isArray(manual.cellLefs)
            ? manual.cellLefs.filter((item): item is string => typeof item === 'string')
            : [],
          liberty: Array.isArray(manual.liberty)
            ? manual.liberty.filter((item): item is string => typeof item === 'string')
            : [],
        }
      : null,
  }
}

function withProjectDesignName(
  baseDesign: ProjectManifestBaseDesign,
  designName: string,
): ProjectManifestBaseDesign {
  return {
    ...baseDesign,
    parameters: {
      ...baseDesign.parameters,
      design: designName,
    },
  }
}

function buildParameterPatch(
  baseParameters: Record<string, unknown>,
  nextParameters: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  return Object.fromEntries(
    Object.entries(nextParameters)
      .filter(([key, value]) => baseParameters[key] !== value)
      .map(([key, value]) => [
        key,
        {
          from: Object.prototype.hasOwnProperty.call(baseParameters, key)
            ? baseParameters[key]
            : undefined,
          to: value,
        },
      ]),
  )
}

function defaultSourceOutputType(
  projectType: ProjectManifestType,
  step: ProjectManifestStage,
): 'verilog' | 'def' | 'report' {
  if (projectType === 'frontend') return 'report'
  return step === 'Synth' ? 'verilog' : 'def'
}

function normalizeProjectManifestPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.length <= 1) return normalized
  return normalized.replace(/\/+$/g, '')
}

function basenameProjectManifestPath(path: string): string {
  return normalizeProjectManifestPath(path).split('/').filter(Boolean).pop() ?? ''
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
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
