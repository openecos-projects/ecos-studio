import { basename, resolve } from 'node:path'
import {
  createProjectManifestDraft,
  serializeProjectManifest,
  type EccWorkspaceCreateRequest,
  type EccWorkspaceOpenRequest,
  type EccWorkspacePdkConfigPersist,
  type MpcSpecReadResult,
  type PdkBindRequest,
  type PdkBinding,
  type PdkInstallationSnapshot,
  type PdkRequirement,
  type PdkResolveBindingRequest,
  type PdkWorkspaceValidationRequest,
  type ProjectManifest,
  validateMpcSpec,
} from '@ecos-studio/shared'

export interface WorkspacePdkBindingDependencies {
  workspaceService?: {
    pathExists(path: string): Promise<boolean>
    registerProjectRoot(path: string): Promise<string>
    writeProjectTextFile(path: string, content: string): Promise<void>
  }
  pdkInventoryService: {
    bindInstallation(request: PdkBindRequest): Promise<PdkBinding>
    resolveBinding(request: PdkResolveBindingRequest): Promise<PdkBinding | null>
    validateWorkspace(
      request: PdkWorkspaceValidationRequest,
    ): Promise<PdkInstallationSnapshot>
  }
  projectManagementReadService?: {
    readManifest(projectRoot: string): Promise<ProjectManifest | null>
  }
  eccRuntimeService?: {
    callRuntime?<T>(method: string, params: Record<string, unknown>): Promise<T>
  }
  resourceManagerService?: {
    getResource(resourceId: string): Promise<unknown>
    readMpcSpec(resourceId: string): Promise<MpcSpecReadResult>
  }
  projectEccConfigService?: {
    write(request: {
      projectRoot: string
      pdkRoot?: string
      pdkName?: string
      externalPaths?: string[]
      overrides?: EccWorkspacePdkConfigPersist['overrides']
    }): Promise<unknown>
  }
}

export async function ensureBackendProjectManifestForCreate(
  dependencies: {
    workspaceService: NonNullable<WorkspacePdkBindingDependencies['workspaceService']>
  },
  request: EccWorkspaceCreateRequest,
): Promise<void> {
  const projectRoot = request.projectRoot?.trim()
  if (!projectRoot || resolve(projectRoot) === resolve(request.targetDirectory)) return

  const manifestPath = resolve(projectRoot, 'project.json')
  if (await dependencies.workspaceService.pathExists(manifestPath)) return

  await dependencies.workspaceService.registerProjectRoot(projectRoot)
  const design = isRecord(request.workspaceSpec.design)
    ? request.workspaceSpec.design
    : {}
  const manifest = createProjectManifestDraft({
    rootPath: projectRoot,
    name: basename(projectRoot),
    designName:
      typeof design.name === 'string' && design.name.trim()
        ? design.name.trim()
        : basename(projectRoot),
    projectType: 'backend',
  })
  if (request.projectId) manifest.project_id = request.projectId
  await dependencies.workspaceService.writeProjectTextFile(
    manifestPath,
    serializeProjectManifest(manifest),
  )
}

export async function prepareWorkspaceCreateBinding(
  dependencies: WorkspacePdkBindingDependencies,
  request: EccWorkspaceCreateRequest,
): Promise<EccWorkspaceCreateRequest> {
  const projectRoot = request.projectRoot ?? ''
  const persistedRequirement =
    !request.pdkRequirement && projectRoot && dependencies.projectManagementReadService
      ? (await dependencies.projectManagementReadService.readManifest(projectRoot))
          ?.base_design.pdk_requirement
      : undefined
  const requirement = request.pdkRequirement ?? persistedRequirement
  if (!requirement) {
    throw new Error('PDK Requirement is required for backend workspace creation')
  }

  const projectId = request.projectId ?? ''
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
  const requestedMpc = request.workspaceSpec.mpc
  const mpcBinding =
    requestedMpc === undefined
      ? null
      : await resolveMpcBinding(dependencies, requestedMpc)
  if (requestedMpc !== undefined && !mpcBinding) {
    throw new Error('Project MPC Requirement is unbound')
  }
  const {
    pdkInstallationId: _pdkInstallationId,
    pdkRequirement: _pdkRequirement,
    ...runtimeRequest
  } = request
  const { mpc: _mpc, ...workspaceBindings } = request.workspaceBindings
  const specPdk = isRecord(request.workspaceSpec.pdk) ? request.workspaceSpec.pdk : {}
  const bindingPdk = isRecord(request.workspaceBindings.pdk)
    ? request.workspaceBindings.pdk
    : {}
  return {
    ...runtimeRequest,
    workspaceBindings: {
      ...workspaceBindings,
      pdk: {
        ...bindingPdk,
        root: installation.root,
        ...(requirement.version ? { version: requirement.version } : {}),
        ...manualPdkFiles(specPdk, requirement, installation.root),
      },
      ...(mpcBinding ? { mpc: mpcBinding } : {}),
    },
    workspaceSpec: {
      ...request.workspaceSpec,
      pdk: {
        ...specPdk,
        familyId: requirement.familyId,
        ...(requirement.version ? { version: requirement.version } : {}),
      },
    },
  }
}

export async function prepareWorkspaceOpenBinding(
  dependencies: WorkspacePdkBindingDependencies,
  directory: string,
): Promise<EccWorkspaceOpenRequest> {
  const bindingRequirement = await dependencies.eccRuntimeService
    ?.callRuntime?.<Record<string, unknown>>('workspace.binding_requirement', {
      directory,
    })
    .catch(() => null)
  const pdk = bindingRequirement
  if (!pdk || typeof pdk.familyId !== 'string') return { directory }

  const project = await dependencies.eccRuntimeService
    ?.callRuntime?.<{ projectId: string; projectRoot: string } | null>(
      'project.discover',
      { directory },
    )
    .catch(() => null)
  if (!project) return { directory }
  const { projectId, projectRoot } = project
  // ECC pdk.version is the stdcell name, not the inventory package version.
  const pdkRequirement = {
    familyId: pdk.familyId,
    version: null,
    manualConfig: manualPdkConfig(pdk),
  }
  try {
    const installation = await dependencies.pdkInventoryService.validateWorkspace({
      projectId,
      projectRoot,
      requirement: pdkRequirement,
    })
    const mpcBinding = await resolveMpcBinding(dependencies, bindingRequirement?.mpc)
    return {
      directory,
      workspaceBindings: {
        inputs: {},
        pdk: {
          root: installation.root,
          ...(installation.version ? { version: installation.version } : {}),
          ...manualPdkFiles(pdk, pdkRequirement, installation.root),
        },
        ...(mpcBinding ? { mpc: mpcBinding } : {}),
      },
    }
  } catch {
    return { directory }
  }
}

function manualPdkConfig(pdk: Record<string, unknown>): PdkRequirement['manualConfig'] {
  const files = pdk.files
  if (pdk.mode !== 'manual' || !Array.isArray(files)) return null
  const byRole = (role: string) =>
    files.flatMap((value) => {
      if (
        !isRecord(value) ||
        value.role !== role ||
        typeof value.reference !== 'string'
      ) {
        return []
      }
      return [value.reference]
    })
  const tech = byRole('tech')[0]
  const cellLefs = byRole('lef')
  const liberty = byRole('liberty')
  return tech && cellLefs.length && liberty.length
    ? { techLef: tech, cellLefs, liberty }
    : null
}

async function resolveMpcBinding(
  dependencies: WorkspacePdkBindingDependencies,
  value: unknown,
): Promise<{ template: Record<string, unknown> } | null> {
  if (!isRecord(value) || !dependencies.resourceManagerService) return null
  const resourceId = value.resourceId
  const version = value.version
  const designId = value.designId
  if (
    typeof resourceId !== 'string' ||
    typeof version !== 'string' ||
    typeof designId !== 'string'
  ) {
    return null
  }
  try {
    const resource = await dependencies.resourceManagerService.getResource(resourceId)
    if (
      !isRecord(resource) ||
      resource.installed_version !== version ||
      (resource.status !== 'installed' && resource.status !== 'update_available')
    ) {
      return null
    }
    const result = await dependencies.resourceManagerService.readMpcSpec(resourceId)
    const spec = validateMpcSpec(result.spec)
    const design = spec.designs.find(
      (candidate) => candidate.design.design_name === designId,
    )
    return design ? { template: design.coreTemplate } : null
  } catch {
    return null
  }
}

function manualPdkFiles(
  pdk: Record<string, unknown>,
  requirement: PdkRequirement,
  root: string,
): { files?: Record<string, string> } {
  if (pdk.mode !== 'manual' || !Array.isArray(pdk.files) || !requirement.manualConfig) {
    return {}
  }
  const files: Record<string, string> = {}
  let lefIndex = 0
  let libertyIndex = 0
  for (const value of pdk.files) {
    if (!isRecord(value) || typeof value.fileId !== 'string') continue
    if (value.role === 'tech') {
      files[value.fileId] = resolve(root, requirement.manualConfig.techLef)
    }
    if (value.role === 'lef') {
      files[value.fileId] = resolve(
        root,
        requirement.manualConfig.cellLefs[lefIndex++] ?? '',
      )
    }
    if (value.role === 'liberty') {
      files[value.fileId] = resolve(
        root,
        requirement.manualConfig.liberty[libertyIndex++] ?? '',
      )
    }
  }
  return Object.keys(files).length ? { files } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Persist the wizard's ecc.toml PDK declarations (`[pdk] external_paths`
 * and `[pdk.overrides]`) when a workspace create/update carries them. Runs
 * inside the prepare step so a write failure aborts the create cleanly,
 * and the persistence payload never leaks into the ECC runtime request.
 */
export async function persistEccPdkConfigFromCreate(
  dependencies: WorkspacePdkBindingDependencies,
  runtimeRequest: Omit<EccWorkspaceCreateRequest, 'eccPdkConfig'>,
  persistConfig: EccWorkspacePdkConfigPersist | undefined,
): Promise<void> {
  if (!persistConfig) return
  const hasExternalPaths = (persistConfig.externalPaths?.length ?? 0) > 0
  const hasOverrides = persistConfig.overrides !== undefined
  if (!hasExternalPaths && !hasOverrides) return
  if (!dependencies.projectEccConfigService) {
    throw new Error('Project ecc.toml persistence is unavailable')
  }
  if (!runtimeRequest.projectRoot) {
    // ecc.toml is a project declaration; without a project root there is
    // nothing sensible to persist against (renderer requests always carry
    // one — standalone workspaces use the target directory itself).
    throw new Error('ecc.toml persistence requires a project root')
  }

  const projectRoot = runtimeRequest.projectRoot
  const bindingPdk = isRecord(runtimeRequest.workspaceBindings.pdk)
    ? runtimeRequest.workspaceBindings.pdk
    : {}
  const specPdk = isRecord(runtimeRequest.workspaceSpec.pdk)
    ? runtimeRequest.workspaceSpec.pdk
    : {}
  await dependencies.projectEccConfigService.write({
    projectRoot,
    ...(typeof bindingPdk.root === 'string' && bindingPdk.root
      ? { pdkRoot: bindingPdk.root }
      : {}),
    ...(typeof specPdk.familyId === 'string' && specPdk.familyId
      ? { pdkName: specPdk.familyId }
      : {}),
    ...persistConfig,
  })
}
