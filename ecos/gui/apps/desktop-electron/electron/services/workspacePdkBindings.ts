import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  parseProjectManifest,
  type EccWorkspaceCreateRequest,
  type EccWorkspaceOpenRequest,
  type PdkBindRequest,
  type PdkBinding,
  type PdkInstallationSnapshot,
  type PdkRequirement,
  type PdkResolveBindingRequest,
  type PdkWorkspaceValidationRequest,
} from '@ecos-studio/shared'

export interface WorkspacePdkBindingDependencies {
  pdkInventoryService: {
    bindInstallation(request: PdkBindRequest): Promise<PdkBinding>
    resolveBinding(request: PdkResolveBindingRequest): Promise<PdkBinding | null>
    validateWorkspace(
      request: PdkWorkspaceValidationRequest,
    ): Promise<PdkInstallationSnapshot>
  }
  projectManagementReadService?: {
    readManifest(projectRoot: string): Promise<string | null>
  }
}

export async function prepareWorkspaceCreateBinding(
  dependencies: WorkspacePdkBindingDependencies,
  request: EccWorkspaceCreateRequest,
): Promise<EccWorkspaceCreateRequest> {
  if (!request.pdkRequirement) {
    throw new Error('PDK Requirement is required for backend workspace creation')
  }

  const projectRoot = request.projectRoot ?? ''
  const { projectId, requirement } = await resolveProjectRequirement(
    dependencies,
    request.projectId ?? '',
    projectRoot,
    request.pdkRequirement,
  )
  const binding = await dependencies.pdkInventoryService.resolveBinding({
    projectId,
    projectRoot,
    requirement,
  })
  if (!binding) {
    if (!request.pdkInstallationId) {
      throw new Error('Project PDK Requirement is unbound')
    }
    await dependencies.pdkInventoryService.bindInstallation({
      installationId: request.pdkInstallationId,
      requirement,
      projectId,
      projectRoot,
    })
  }
  const installation = await dependencies.pdkInventoryService.validateWorkspace({
    projectId,
    projectRoot,
    requirement,
  })
  const {
    pdkInstallationId: _pdkInstallationId,
    pdkRequirement: _pdkRequirement,
    projectId: _projectId,
    projectRoot: _projectRoot,
    ...runtimeRequest
  } = request
  return {
    ...runtimeRequest,
    pdk: requirement.familyId,
    pdkRoot: installation.root,
    pdkVersion: requirement.version,
    ...(requirement.manualConfig
      ? {
          pdkConfigMode: 'manual' as const,
          pdkConfig: {
            tech_lef: [requirement.manualConfig.techLef],
            cell_lef: requirement.manualConfig.cellLefs,
            liberty: requirement.manualConfig.liberty,
          },
        }
      : {}),
  }
}

export async function prepareWorkspaceOpenBinding(
  dependencies: WorkspacePdkBindingDependencies,
  directory: string,
): Promise<EccWorkspaceOpenRequest> {
  const spec = await readWorkspaceSpec(directory)
  const pdk = isRecord(spec?.pdk) ? spec.pdk : null
  if (!pdk || typeof pdk.familyId !== 'string') return { directory }

  const projectRoot = dirname(directory)
  const { projectId, requirement } = await resolveProjectRequirement(
    dependencies,
    '',
    projectRoot,
    {
      familyId: pdk.familyId,
      version: typeof pdk.version === 'string' ? pdk.version : null,
      manualConfig: null,
    },
  )
  try {
    const installation = await dependencies.pdkInventoryService.validateWorkspace({
      projectId,
      projectRoot,
      requirement,
    })
    return {
      directory,
      workspaceBindings: {
        inputs: {},
        pdk: {
          root: installation.root,
          ...(requirement.version ? { version: requirement.version } : {}),
          ...manualPdkFiles(pdk, requirement),
        },
      },
    }
  } catch {
    return { directory }
  }
}

async function resolveProjectRequirement(
  dependencies: WorkspacePdkBindingDependencies,
  requestedProjectId: string,
  projectRoot: string,
  requested: PdkRequirement,
): Promise<{ projectId: string; requirement: PdkRequirement }> {
  if (!projectRoot || !dependencies.projectManagementReadService) {
    return { projectId: requestedProjectId, requirement: requested }
  }
  const manifestText =
    await dependencies.projectManagementReadService.readManifest(projectRoot)
  if (!manifestText) return { projectId: requestedProjectId, requirement: requested }
  const manifest = parseProjectManifest(manifestText)
  return {
    projectId: manifest.project_id,
    requirement: manifest.base_design.pdk_requirement ?? requested,
  }
}

async function readWorkspaceSpec(
  directory: string,
): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(
      await readFile(join(directory, 'home', 'workspace-spec.json'), 'utf8'),
    ) as Record<string, unknown>
  } catch {
    return null
  }
}

function manualPdkFiles(
  pdk: Record<string, unknown>,
  requirement: PdkRequirement,
): { files?: Record<string, string> } {
  if (pdk.mode !== 'manual' || !Array.isArray(pdk.files) || !requirement.manualConfig) {
    return {}
  }
  const files: Record<string, string> = {}
  let lefIndex = 0
  let libertyIndex = 0
  for (const value of pdk.files) {
    if (!isRecord(value) || typeof value.fileId !== 'string') continue
    if (value.role === 'tech') files[value.fileId] = requirement.manualConfig.techLef
    if (value.role === 'lef') {
      files[value.fileId] = requirement.manualConfig.cellLefs[lefIndex++] ?? ''
    }
    if (value.role === 'liberty') {
      files[value.fileId] = requirement.manualConfig.liberty[libertyIndex++] ?? ''
    }
  }
  return Object.keys(files).length ? { files } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
