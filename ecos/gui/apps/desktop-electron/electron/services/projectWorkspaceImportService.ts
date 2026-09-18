import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import type {
  DesktopProjectManagementWorkspaceImportFailureCode,
  DesktopProjectManagementWorkspaceImportResult,
  ProjectManifest,
  ProjectManifestMutationRequest,
} from '@ecos-studio/shared'
import { EccJsonRpcError } from './eccRpc/jsonRpcClient'
import { isPathWithinRoot } from './pathScope'

export class ProjectWorkspaceImportError extends Error {
  constructor(
    readonly code: DesktopProjectManagementWorkspaceImportFailureCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProjectWorkspaceImportError'
  }
}

export interface ProjectWorkspaceManifestGateway {
  load(projectRoot: string): Promise<ProjectManifest>
  mutate(request: ProjectManifestMutationRequest): Promise<{ manifest: ProjectManifest }>
}

export type ProjectWorkspaceImportSuccess = Extract<
  DesktopProjectManagementWorkspaceImportResult,
  { status: 'imported' | 'already_registered' }
>

export class ProjectWorkspaceImportService {
  constructor(private readonly manifestGateway: ProjectWorkspaceManifestGateway) {}

  async importWorkspace(
    requestedProjectRoot: string,
    requestedWorkspacePath: string,
  ): Promise<ProjectWorkspaceImportSuccess> {
    const projectRoot = await canonicalizeDirectory(
      requestedProjectRoot,
      'project_invalid',
      'Project folder',
    )
    const workspacePath = await canonicalizeDirectory(
      requestedWorkspacePath,
      'workspace_not_importable',
      'Workspace folder',
    )
    validateWorkspaceRoot(projectRoot, workspacePath)

    const manifest = await this.loadProjectManifest(projectRoot)
    const registeredId = await findRegisteredWorkspaceId(
      manifest,
      projectRoot,
      workspacePath,
    )
    if (registeredId) {
      return {
        status: 'already_registered',
        manifest,
        workspaceId: registeredId,
        workspacePath,
      }
    }
    const workspaceId = basename(workspacePath)
    if (!workspaceId || workspaceId === '.' || workspaceId === '..') {
      throw new ProjectWorkspaceImportError(
        'workspace_not_importable',
        'The selected workspace directory does not have a valid basename.',
      )
    }
    const result = await this.mutateThroughManifestService(
      projectRoot,
      workspacePath,
      workspaceId,
    )
    return {
      status: 'imported',
      manifest: result.manifest,
      workspaceId,
      workspacePath,
    }
  }

  private async loadProjectManifest(projectRoot: string): Promise<ProjectManifest> {
    try {
      return await this.manifestGateway.load(projectRoot)
    } catch (error) {
      throw new ProjectWorkspaceImportError(
        'project_invalid',
        `The selected project is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  private async mutateThroughManifestService(
    projectRoot: string,
    workspacePath: string,
    workspaceId: string,
  ): Promise<{ manifest: ProjectManifest }> {
    try {
      return await this.manifestGateway.mutate({
        projectRoot,
        mutation: {
          type: 'import-workspace',
          input: { projectRoot, workspacePath, workspaceId },
        },
      })
    } catch (error) {
      throw translateManifestMutationError(error)
    }
  }
}

export function projectWorkspaceImportFailure(
  error: unknown,
): Extract<DesktopProjectManagementWorkspaceImportResult, { status: 'failed' }> {
  const failure =
    error instanceof ProjectWorkspaceImportError
      ? error
      : translateManifestMutationError(error)
  return { status: 'failed', code: failure.code, message: failure.message }
}

const RUNTIME_IMPORT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'workspace_id_conflict',
  'workspace_not_importable',
  'workspace_path_conflict',
])

function translateManifestMutationError(error: unknown): ProjectWorkspaceImportError {
  if (error instanceof EccJsonRpcError) {
    if (RUNTIME_IMPORT_FAILURE_CODES.has(error.message)) {
      return new ProjectWorkspaceImportError(
        error.message as DesktopProjectManagementWorkspaceImportFailureCode,
        rpcErrorMessage(error) || error.message,
      )
    }
    return new ProjectWorkspaceImportError(
      'project_invalid',
      rpcErrorMessage(error) || error.message,
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  return new ProjectWorkspaceImportError(
    'project_invalid',
    message || 'Workspace import failed.',
  )
}

function rpcErrorMessage(error: EccJsonRpcError): string {
  const data = error.data
  if (typeof data === 'object' && data !== null && 'message' in data) {
    const message = (data as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

async function canonicalizeDirectory(
  path: string,
  code: DesktopProjectManagementWorkspaceImportFailureCode,
  label: string,
): Promise<string> {
  try {
    const canonicalPath = await realpath(path)
    if (!(await stat(canonicalPath)).isDirectory()) {
      throw new Error(`${label} is not a directory.`)
    }
    return canonicalPath
  } catch (error) {
    throw new ProjectWorkspaceImportError(
      code,
      `${label} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function validateWorkspaceRoot(projectRoot: string, workspacePath: string): void {
  if (
    workspacePath === projectRoot ||
    isPathWithinRoot(projectRoot, workspacePath) ||
    workspacePath === resolve(projectRoot, 'runs')
  ) {
    throw new ProjectWorkspaceImportError(
      'workspace_not_importable',
      'The selected workspace path is a protected project directory or its ancestor.',
    )
  }
}

async function findRegisteredWorkspaceId(
  manifest: ProjectManifest,
  projectRoot: string,
  workspacePath: string,
): Promise<string | null> {
  for (const workspace of manifest.workspaces) {
    if (workspace.status === 'archived') continue
    const registeredPath = await canonicalizeManifestWorkspacePath(
      workspace.workspace_path,
      projectRoot,
    )
    if (registeredPath === workspacePath) return workspace.workspace_id
  }
  return null
}

async function canonicalizeManifestWorkspacePath(
  workspacePath: string,
  projectRoot: string,
): Promise<string> {
  const candidate = isAbsolute(workspacePath)
    ? resolve(workspacePath)
    : resolve(projectRoot, workspacePath)
  if (!isAbsolute(workspacePath) && !isPathWithinRoot(candidate, projectRoot)) {
    throw new ProjectWorkspaceImportError(
      'project_invalid',
      `Relative workspace path escapes the project root: ${workspacePath}.`,
    )
  }
  try {
    return await realpath(candidate)
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) return candidate
    throw error
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === code
  )
}
