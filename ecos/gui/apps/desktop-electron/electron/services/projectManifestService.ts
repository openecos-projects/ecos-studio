import { basename, isAbsolute, resolve } from 'node:path'
import { projectManifestForPresentation } from '@ecos-studio/shared'
import type {
  EccProjectManifest,
  ProjectManifest,
  ProjectManifestMutation,
  ProjectManifestMutationRequest,
  ProjectManifestMutationResult,
  WorkspaceDirectoryReplacement,
} from '@ecos-studio/shared'
import { isPathWithinRoot } from './pathScope'
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

export interface ProjectManifestRuntime {
  callRuntime<T>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<T>
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
    private readonly replacementProvider: ProjectManifestReplacementProvider | undefined,
    private readonly runtime: ProjectManifestRuntime,
  ) {}

  async mutate(
    request: ProjectManifestMutationRequest,
  ): Promise<ProjectManifestMutationResult> {
    if (!request?.projectRoot?.trim()) {
      throw new Error('Project manifest mutation requires a project root')
    }
    validateProjectManifestMutation(request.mutation)
    const projectRoot = await this.projectScopeProvider.resolveProjectRoot(
      request.projectRoot,
    )
    return await this.enqueue(projectRoot, () =>
      this.mutateThroughRuntime(projectRoot, request.mutation),
    )
  }

  async load(requestedProjectRoot: string): Promise<ProjectManifest> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    return projectManifestForPresentation(
      await this.loadManifest(projectRoot),
      projectRoot,
    )
  }

  async discover(directory: string): Promise<ProjectManifest | null> {
    const discovered = await this.runtime.callRuntime<{
      projectId: string
      projectRoot: string
    } | null>('project.discover', { directory })
    if (!discovered) return null
    const projectRoot = await this.projectScopeProvider.resolveProjectRoot(
      discovered.projectRoot,
    )
    const manifest = await this.loadManifest(projectRoot)
    if (manifest.project_id !== discovered.projectId) {
      throw new Error('Discovered Project identity changed while loading its Manifest.')
    }
    return projectManifestForPresentation(manifest, projectRoot)
  }

  async inspectWorkspaceRegistration(
    requestedProjectRoot: string,
    workspacePath: string,
    expectedProjectId?: string,
  ): Promise<WorkspaceRegistrationEvidence | null> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    return await this.enqueue(projectRoot, async () => {
      const manifest = await this.loadManifest(projectRoot)
      requireProjectIdentity(manifest, expectedProjectId)
      return workspaceRegistrationEvidence(manifest, workspacePath, projectRoot)
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
      const manifest = await this.loadManifest(projectRoot)
      requireProjectIdentity(manifest, expectedProjectId)
      const existing = workspaceRegistrationEvidence(manifest, workspacePath, projectRoot)
      if (existing) return existing
      const updated = await this.mutateManifest(projectRoot, {
        type: 'register-workspace',
        input: { projectRoot, workspacePath },
      })
      return workspaceRegistrationEvidence(updated, workspacePath, projectRoot)!
    })
  }

  async removeWorkspaceRegistration(
    requestedProjectRoot: string,
    evidence: WorkspaceRegistrationEvidence,
  ): Promise<void> {
    const projectRoot =
      await this.projectScopeProvider.resolveProjectRoot(requestedProjectRoot)
    await this.enqueue(projectRoot, async () => {
      const manifest = await this.loadManifest(projectRoot)
      const current = workspaceRegistrationEvidence(
        manifest,
        evidence.workspacePath,
        projectRoot,
      )
      if (!current || current.fingerprint !== evidence.fingerprint) {
        throw new Error(
          'Project manifest registration changed after Workspace creation; registration was preserved.',
        )
      }
      await this.mutateManifest(projectRoot, {
        type: 'delete-workspace',
        workspaceId: evidence.workspaceId,
      })
    })
  }

  private async mutateThroughRuntime(
    projectRoot: string,
    requestedMutation: ProjectManifestMutation,
  ): Promise<ProjectManifestMutationResult> {
    let mutation: ProjectManifestMutation | Record<string, unknown> = requestedMutation
    let directoryReplacement: WorkspaceDirectoryReplacement | null = null
    if (requestedMutation.type === 'record-replacement-backup') {
      const replacement = this.requireProjectReplacement(
        requestedMutation.input.replacementId,
        projectRoot,
      )
      mutation = {
        type: 'register-workspace',
        input: {
          lifecycle: 'archived',
          name: `${basename(replacement.targetPath)} backup`,
          workspacePath: replacement.backupPath,
        },
      }
      await this.setReplacementRecoveryMode(
        requestedMutation.input.replacementId,
        projectRoot,
        'retain',
      )
    }
    if (
      requestedMutation.type === 'delete-workspace' &&
      requestedMutation.deleteDirectory
    ) {
      const manifest = await this.loadManifest(projectRoot)
      const workspace = manifest.workspaces.find(
        (candidate) => candidate.workspace_id === requestedMutation.workspaceId,
      )
      if (workspace) {
        if (!this.replacementProvider) {
          throw new Error('Workspace replacement support is unavailable.')
        }
        directoryReplacement =
          await this.replacementProvider.prepareManagedProjectWorkspaceDirectoryReplacement(
            projectRoot,
            requestedMutation.workspaceId,
            absoluteWorkspacePath(projectRoot, workspace.workspace_path),
          )
        if (directoryReplacement) {
          await this.setReplacementRecoveryMode(
            directoryReplacement.id,
            projectRoot,
            'delete',
          )
        }
      }
    }

    let manifest: EccProjectManifest
    try {
      manifest = await this.mutateManifest(projectRoot, mutation)
    } catch (error) {
      if (directoryReplacement) {
        await this.replacementProvider!.restoreProjectDirectoryReplacement(
          directoryReplacement.id,
        ).catch(() => undefined)
      }
      throw error
    }

    let cleanupPending = false
    const replacementId =
      requestedMutation.type === 'record-replacement-backup'
        ? requestedMutation.input.replacementId
        : directoryReplacement?.id
    if (replacementId) {
      try {
        if (requestedMutation.type === 'record-replacement-backup') {
          await this.replacementProvider!.retainProjectDirectoryReplacement(replacementId)
        } else {
          await this.replacementProvider!.finalizeProjectDirectoryReplacement(
            replacementId,
          )
        }
      } catch {
        cleanupPending = true
      }
    }
    return {
      manifest: projectManifestForPresentation(manifest, projectRoot),
      ...(cleanupPending ? { cleanupPending } : {}),
    }
  }

  private loadManifest(projectRoot: string): Promise<EccProjectManifest> {
    return this.runtime.callRuntime('project.manifest.load', { projectRoot })
  }

  private mutateManifest(
    projectRoot: string,
    mutation: ProjectManifestMutation | Record<string, unknown>,
  ): Promise<EccProjectManifest> {
    return this.runtime.callRuntime('project.manifest.mutate', {
      projectRoot,
      mutation,
    })
  }

  private async setReplacementRecoveryMode(
    replacementId: string,
    projectRoot: string,
    recoveryMode: 'delete' | 'retain',
  ): Promise<void> {
    this.requireProjectReplacement(replacementId, projectRoot)
    await this.replacementProvider!.setProjectDirectoryReplacementRecoveryMode(
      replacementId,
      recoveryMode,
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
      if (this.queues.get(projectRoot) === queued) this.queues.delete(projectRoot)
    }
  }
}

function workspaceRegistrationEvidence(
  manifest: EccProjectManifest,
  workspacePath: string,
  projectRoot: string,
): WorkspaceRegistrationEvidence | null {
  const normalizedPath = normalizePath(workspacePath)
  const workspaceId = basename(normalizedPath)
  const candidates = manifest.workspaces.filter(
    (workspace) =>
      workspace.workspace_id === workspaceId ||
      absoluteWorkspacePath(projectRoot, workspace.workspace_path) === normalizedPath,
  )
  if (candidates.length === 0) return null
  const matchingPaths = candidates.filter(
    (candidate) =>
      absoluteWorkspacePath(projectRoot, candidate.workspace_path) === normalizedPath,
  )
  if (matchingPaths.length !== 1 || candidates.length !== 1) {
    throw new Error(
      'Project manifest has a conflicting Workspace identity or path; registration was preserved.',
    )
  }
  const workspace = matchingPaths[0]!
  return {
    fingerprint: JSON.stringify(workspace),
    projectId: manifest.project_id,
    workspaceId: workspace.workspace_id,
    workspacePath: normalizedPath,
  }
}

function absoluteWorkspacePath(projectRoot: string, workspacePath: string): string {
  return normalizePath(
    isAbsolute(workspacePath) ? workspacePath : resolve(projectRoot, workspacePath),
  )
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/+$/g, '') : normalized
}

function requireProjectIdentity(
  manifest: EccProjectManifest,
  expectedProjectId?: string,
): void {
  if (expectedProjectId && manifest.project_id !== expectedProjectId) {
    throw new Error(
      'Project manifest identity changed after Workspace creation; registration was preserved.',
    )
  }
}
