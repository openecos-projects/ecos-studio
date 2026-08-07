import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import {
  applyProjectManifestMutation,
  isProjectManifestType,
  parseProjectManifest,
  recordReplacementBackupInManifest,
  serializeProjectManifest,
  type ProjectManifestMutation,
  type ProjectManifestMutationRequest,
  type ProjectManifestMutationResult,
  type WorkspaceDirectoryReplacement,
} from '@ecos-studio/shared'

export interface ProjectManifestScopeProvider {
  resolveProjectRoot(path: string): Promise<string>
}

export interface ProjectManifestReplacementProvider {
  getProjectDirectoryReplacement(replacementId: string): {
    backupPath: string
    projectRoot: string
    targetPath: string
  }
  finalizeProjectDirectoryReplacement(replacementId: string): Promise<void>
  prepareManagedProjectWorkspaceDirectoryReplacement(
    projectRoot: string,
    workspaceId: string,
    workspacePath: string,
  ): Promise<WorkspaceDirectoryReplacement | null>
  retainProjectDirectoryReplacement(replacementId: string): Promise<void>
  restoreProjectDirectoryReplacement(replacementId: string): Promise<void>
  setProjectDirectoryReplacementRecoveryMode(
    replacementId: string,
    recoveryMode: 'delete' | 'retain',
  ): Promise<void>
}

export class ProjectManifestService {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly projectScopeProvider: ProjectManifestScopeProvider,
    private readonly replacementProvider?: ProjectManifestReplacementProvider,
  ) {}

  async mutate(
    request: ProjectManifestMutationRequest,
  ): Promise<ProjectManifestMutationResult> {
    if (
      !request ||
      typeof request.projectRoot !== 'string' ||
      !request.projectRoot.trim()
    ) {
      throw new Error('Project manifest mutation requires a project root')
    }
    validateProjectManifestMutation(request.mutation)

    const projectRoot = await this.projectScopeProvider.resolveProjectRoot(
      request.projectRoot,
    )
    return await this.enqueue(projectRoot, async () => {
      const manifestPath = join(projectRoot, 'project.json')
      const currentContent = await readOptionalTextFile(manifestPath)
      const currentManifest =
        currentContent === null ? null : parseProjectManifest(currentContent)
      if (currentManifest) {
        const manifestRoot = await this.projectScopeProvider.resolveProjectRoot(
          currentManifest.root_path,
        )
        if (manifestRoot !== projectRoot) {
          throw new Error(
            'Project manifest root_path does not match its containing directory.',
          )
        }
      }
      if (request.mutation.type === 'create' && currentManifest) {
        throw new Error('Project manifest already exists.')
      }
      const manifest =
        request.mutation.type === 'record-replacement-backup'
          ? this.applyReplacementBackupMutation(
              currentManifest,
              projectRoot,
              request.mutation,
            )
          : applyProjectManifestMutation(currentManifest, projectRoot, request.mutation)
      const directoryReplacement =
        request.mutation.type === 'delete-workspace' && request.mutation.deleteDirectory
          ? await this.prepareManagedWorkspaceDeletion(
              currentManifest,
              projectRoot,
              request.mutation.workspaceId,
            )
          : null
      const content = serializeProjectManifest(manifest)
      try {
        if (request.mutation.type === 'record-replacement-backup') {
          await this.setReplacementRecoveryMode(
            request.mutation.input.replacementId,
            projectRoot,
            'retain',
          )
        }
        if (directoryReplacement) {
          await this.setReplacementRecoveryMode(
            directoryReplacement.id,
            projectRoot,
            'delete',
          )
        }
        await writeTextFileAtomically(manifestPath, content)
      } catch (error) {
        if (directoryReplacement) {
          await this.replacementProvider!.restoreProjectDirectoryReplacement(
            directoryReplacement.id,
          ).catch(() => undefined)
        }
        throw error
      }
      let cleanupPending = false
      if (request.mutation.type === 'record-replacement-backup') {
        try {
          await this.replacementProvider!.retainProjectDirectoryReplacement(
            request.mutation.input.replacementId,
          )
        } catch {
          // The manifest now references the backup and recovery mode is retain.
          cleanupPending = true
        }
      }
      if (directoryReplacement) {
        try {
          await this.replacementProvider!.finalizeProjectDirectoryReplacement(
            directoryReplacement.id,
          )
        } catch {
          cleanupPending = true
        }
      }
      return { content, ...(cleanupPending ? { cleanupPending } : {}) }
    })
  }

  private applyReplacementBackupMutation(
    currentManifest: ReturnType<typeof parseProjectManifest> | null,
    projectRoot: string,
    mutation: Extract<
      ProjectManifestMutationRequest['mutation'],
      { type: 'record-replacement-backup' }
    >,
  ) {
    if (!currentManifest) throw new Error('Project manifest does not exist.')
    if (!this.replacementProvider) {
      throw new Error('Workspace replacement support is unavailable.')
    }
    const replacement = this.requireProjectReplacement(
      mutation.input.replacementId,
      projectRoot,
    )
    return recordReplacementBackupInManifest(currentManifest, {
      backupPath: replacement.backupPath,
      targetPath: replacement.targetPath,
      fallbackStartStep: mutation.input.fallbackStartStep,
      fallbackEndStep: mutation.input.fallbackEndStep,
    })
  }

  private async setReplacementRecoveryMode(
    replacementId: string,
    projectRoot: string,
    recoveryMode: 'delete' | 'retain',
  ): Promise<void> {
    if (!this.replacementProvider) {
      throw new Error('Workspace replacement support is unavailable.')
    }
    this.requireProjectReplacement(replacementId, projectRoot)
    await this.replacementProvider.setProjectDirectoryReplacementRecoveryMode(
      replacementId,
      recoveryMode,
    )
  }

  private async prepareManagedWorkspaceDeletion(
    currentManifest: ReturnType<typeof parseProjectManifest> | null,
    projectRoot: string,
    workspaceId: string,
  ): Promise<WorkspaceDirectoryReplacement | null> {
    if (!currentManifest) return null
    const workspace = currentManifest.workspaces.find(
      (candidate) => candidate.workspace_id === workspaceId,
    )
    if (!workspace) return null
    if (!this.replacementProvider) {
      throw new Error('Workspace replacement support is unavailable.')
    }
    return await this.replacementProvider.prepareManagedProjectWorkspaceDirectoryReplacement(
      projectRoot,
      workspaceId,
      workspace.workspace_path,
    )
  }

  private requireProjectReplacement(replacementId: string, projectRoot: string) {
    if (!this.replacementProvider) {
      throw new Error('Workspace replacement support is unavailable.')
    }
    const replacement =
      this.replacementProvider.getProjectDirectoryReplacement(replacementId)
    if (
      replacement.projectRoot !== projectRoot ||
      !isWithinRoot(replacement.targetPath, replacement.projectRoot) ||
      !isWithinRoot(replacement.backupPath, replacement.projectRoot)
    ) {
      throw new Error('Workspace replacement does not belong to this project manifest.')
    }
    return replacement
  }

  private async enqueue<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectRoot) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const queued = next.then(
      () => undefined,
      () => undefined,
    )
    this.queues.set(projectRoot, queued)

    try {
      return await next
    } finally {
      if (this.queues.get(projectRoot) === queued) {
        this.queues.delete(projectRoot)
      }
    }
  }
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, candidatePath)
  return (
    relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function validateProjectManifestMutation(
  mutation: unknown,
): asserts mutation is ProjectManifestMutation {
  if (!isRecord(mutation) || typeof mutation.type !== 'string') {
    throw new Error('Project manifest mutation is required')
  }

  switch (mutation.type) {
    case 'create':
      requireString(mutation.name, 'Project manifest create mutation name')
      if (
        mutation.projectType !== undefined &&
        !isProjectManifestType(mutation.projectType)
      ) {
        throw new Error(
          'Project manifest create mutation projectType must be backend or frontend',
        )
      }
      validateProjectManifestMpc(mutation.mpc)
      return
    case 'register-workspace': {
      const input = requireRecord(
        mutation.input,
        'Project manifest workspace registration input',
      )
      requireString(input.projectRoot, 'Project manifest workspace projectRoot')
      requireString(input.workspacePath, 'Project manifest workspace path')
      requireOptionalString(input.projectName, 'Project manifest workspace projectName')
      requireOptionalString(
        input.sourceWorkspaceId,
        'Project manifest source workspace id',
      )
      requireOptionalString(input.sourceStep, 'Project manifest source step')
      requireOptionalString(input.sourceOutputPath, 'Project manifest source output path')
      requireOptionalString(input.sourceOutputType, 'Project manifest source output type')
      requireOptionalString(input.startStep, 'Project manifest start step')
      requireOptionalString(input.endStep, 'Project manifest end step')
      if (input.config !== undefined) validateWorkspaceConfig(input.config)
      return
    }
    case 'archive-workspace':
    case 'delete-workspace':
      requireString(mutation.workspaceId, 'Project manifest workspace id')
      if (
        mutation.type === 'delete-workspace' &&
        mutation.deleteDirectory !== undefined
      ) {
        if (typeof mutation.deleteDirectory !== 'boolean') {
          throw new Error(
            'Project manifest deleteDirectory must be a boolean when provided',
          )
        }
      }
      return
    case 'record-replacement-backup': {
      const input = requireRecord(
        mutation.input,
        'Project manifest replacement backup input',
      )
      requireString(input.replacementId, 'Workspace replacement id')
      requireOptionalString(
        input.fallbackStartStep,
        'Project manifest fallback start step',
      )
      requireOptionalString(input.fallbackEndStep, 'Project manifest fallback end step')
      return
    }
    default:
      throw new Error('Unsupported project manifest mutation')
  }
}

function validateWorkspaceConfig(value: unknown): void {
  const config = requireRecord(value, 'Project manifest workspace config')
  for (const key of ['pdk', 'pdk_root', 'origin_verilog', 'origin_def']) {
    requireOptionalString(config[key], `Project manifest workspace config ${key}`)
  }
  if (config.rtl_list !== undefined) {
    if (
      !Array.isArray(config.rtl_list) ||
      config.rtl_list.some((item) => typeof item !== 'string')
    ) {
      throw new Error(
        'Project manifest workspace config rtl_list must be an array of strings',
      )
    }
  }
  if (config.parameters !== undefined && !isRecord(config.parameters)) {
    throw new Error('Project manifest workspace config parameters must be an object')
  }
}

function validateProjectManifestMpc(value: unknown): void {
  if (value === undefined || value === null) return
  const mpc = requireRecord(value, 'Project manifest MPC')
  const resourceId = requireString(mpc.resource_id, 'Project manifest MPC resource_id')
  if (!resourceId.startsWith('mpc:') || resourceId.length === 4) {
    throw new Error('Project manifest MPC resource_id must be an MPC resource id')
  }
  requireString(mpc.display_name, 'Project manifest MPC display_name')
  requireString(mpc.installed_version, 'Project manifest MPC installed_version')
  const mpcPath = normalizeMpcPath(requireString(mpc.path, 'Project manifest MPC path'))
  const specPath = normalizeMpcPath(
    requireString(mpc.spec_path, 'Project manifest MPC spec_path'),
  )
  if (specPath !== `${mpcPath}/spec/spec.json.in`) {
    throw new Error(
      'Project manifest MPC spec_path must reference spec/spec.json.in below MPC path',
    )
  }
  const design = requireRecord(mpc.design, 'Project manifest MPC design')
  if (!Number.isInteger(design.index) || (design.index as number) < 0) {
    throw new Error('Project manifest MPC design index must be a non-negative integer')
  }
  requireString(design.design_name, 'Project manifest MPC design design_name')
  requireOptionalString(design.directory, 'Project manifest MPC design directory')
  requireRecord(mpc.core_template, 'Project manifest MPC core_template')
}

function normalizeMpcPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.length <= 1 ? normalized : normalized.replace(/\/+$/g, '')
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function requireOptionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${name} must be a string when provided`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readOptionalTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return null
    throw error
  }
}

async function writeTextFileAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === code
  )
}
