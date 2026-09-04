import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  applyProjectManifestMutation,
  parseProjectManifest,
  recordReplacementBackupInManifest,
  serializeProjectManifest,
  synchronizeProjectBaseline,
  type ProjectManifest,
  type ProjectManifestMutationRequest,
  type ProjectManifestMutationResult,
  type WorkspaceDirectoryReplacement,
} from '@ecos-studio/shared'
import {
  WorkspaceSnapshotLoader,
  type WorkspaceBaselineSnapshot,
} from './eccRpc/workspaceSnapshotLoader'
import { isPathWithinRoot } from './pathScope'
import { baselineBaseDesign } from './projectManifestBaseline'
import { validateProjectManifestMutation } from './projectManifestMutationValidation'

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

export interface ProjectManifestBaselineSnapshotProvider {
  loadBaselineSnapshot(directory: string): Promise<WorkspaceBaselineSnapshot>
}

export interface WorkspaceRegistrationEvidence {
  fingerprint: string
  projectId: string
  workspaceId: string
  workspacePath: string
}

export class ProjectManifestService {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly projectScopeProvider: ProjectManifestScopeProvider,
    private readonly replacementProvider?: ProjectManifestReplacementProvider,
    private readonly baselineSnapshotProvider: ProjectManifestBaselineSnapshotProvider = new WorkspaceSnapshotLoader(),
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
      const currentManifest = await this.readManifest(projectRoot)
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
          : request.mutation.type === 'select-qor-baseline'
            ? await this.applyQorBaselineMutation(currentManifest, request.mutation)
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

  async inspectWorkspaceRegistration(
    requestedProjectRoot: string,
    workspacePath: string,
    expectedProjectId?: string,
  ): Promise<WorkspaceRegistrationEvidence | null> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    return await this.enqueue(projectRoot, async () => {
      const manifest = await this.readManifest(projectRoot)
      if (!manifest) throw new Error('Project manifest does not exist.')
      requireProjectIdentity(manifest, expectedProjectId)
      return workspaceRegistrationEvidence(manifest, workspacePath)
    })
  }

  async ensureWorkspaceRegistration(
    requestedProjectRoot: string,
    workspacePath: string,
    expectedProjectId?: string,
  ): Promise<WorkspaceRegistrationEvidence> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    return await this.enqueue(projectRoot, async () => {
      const manifest = await this.readManifest(projectRoot)
      if (!manifest) throw new Error('Project manifest does not exist.')
      requireProjectIdentity(manifest, expectedProjectId)
      const existing = workspaceRegistrationEvidence(manifest, workspacePath)
      if (existing) return existing

      const updated = applyProjectManifestMutation(manifest, projectRoot, {
        type: 'register-workspace',
        input: { projectRoot, workspacePath },
      })
      await writeTextFileAtomically(
        join(projectRoot, 'project.json'),
        serializeProjectManifest(updated),
      )
      return workspaceRegistrationEvidence(updated, workspacePath)!
    })
  }

  async removeWorkspaceRegistration(
    requestedProjectRoot: string,
    evidence: WorkspaceRegistrationEvidence,
  ): Promise<void> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    await this.enqueue(projectRoot, async () => {
      const manifest = await this.readManifest(projectRoot)
      if (!manifest) throw new Error('Project manifest does not exist.')
      const current = workspaceRegistrationEvidence(manifest, evidence.workspacePath)
      if (!current || current.fingerprint !== evidence.fingerprint) {
        throw new Error(
          'Project manifest registration changed after Workspace creation; registration was preserved.',
        )
      }
      const updated = applyProjectManifestMutation(manifest, projectRoot, {
        type: 'delete-workspace',
        workspaceId: evidence.workspaceId,
      })
      await writeTextFileAtomically(
        join(projectRoot, 'project.json'),
        serializeProjectManifest(updated),
      )
    })
  }

  private async readManifest(projectRoot: string): Promise<ProjectManifest | null> {
    const content = await readOptionalTextFile(join(projectRoot, 'project.json'))
    if (content === null) return null
    const manifest = parseProjectManifest(content)
    const manifestRoot = await this.projectScopeProvider.resolveProjectRoot(
      manifest.root_path,
    )
    if (manifestRoot !== projectRoot) {
      throw new Error(
        'Project manifest root_path does not match its containing directory.',
      )
    }
    return manifest
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

  private async applyQorBaselineMutation(
    currentManifest: ProjectManifest | null,
    mutation: Extract<
      ProjectManifestMutationRequest['mutation'],
      { type: 'select-qor-baseline' }
    >,
  ): Promise<ProjectManifest> {
    if (!currentManifest) throw new Error('Project manifest does not exist.')
    const workspace = currentManifest.workspaces.find(
      (candidate) =>
        candidate.workspace_id === mutation.workspaceId &&
        candidate.status !== 'archived',
    )
    if (!workspace) {
      throw new Error(
        `Workspace ${mutation.workspaceId} is not available for the project QoR baseline.`,
      )
    }

    const snapshot = await this.baselineSnapshotProvider.loadBaselineSnapshot(
      workspace.workspace_path,
    )
    return synchronizeProjectBaseline(currentManifest, {
      workspaceId: workspace.workspace_id,
      reason: mutation.reason,
      baseDesign: baselineBaseDesign(currentManifest.base_design, snapshot),
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
      !isPathWithinRoot(replacement.targetPath, replacement.projectRoot) ||
      !isPathWithinRoot(replacement.backupPath, replacement.projectRoot)
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

function workspaceRegistrationEvidence(
  manifest: ProjectManifest,
  workspacePath: string,
): WorkspaceRegistrationEvidence | null {
  const normalizedPath = normalizePath(workspacePath)
  const workspaceId = basename(normalizedPath)
  const candidates = manifest.workspaces.filter(
    (workspace) =>
      workspace.workspace_id === workspaceId ||
      normalizePath(workspace.workspace_path) === normalizedPath,
  )
  if (candidates.length === 0) return null
  const workspace = candidates.find(
    (candidate) =>
      candidate.workspace_id === workspaceId &&
      normalizePath(candidate.workspace_path) === normalizedPath,
  )
  if (!workspace || candidates.length !== 1) {
    throw new Error(
      'Project manifest has a conflicting Workspace identity or path; registration was preserved.',
    )
  }
  return {
    fingerprint: JSON.stringify(workspace),
    projectId: manifest.project_id,
    workspaceId,
    workspacePath: normalizedPath,
  }
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/+$/g, '') : normalized
}

function requireProjectIdentity(
  manifest: ProjectManifest,
  expectedProjectId?: string,
): void {
  if (expectedProjectId && manifest.project_id !== expectedProjectId) {
    throw new Error(
      'Project manifest identity changed after Workspace creation; registration was preserved.',
    )
  }
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
