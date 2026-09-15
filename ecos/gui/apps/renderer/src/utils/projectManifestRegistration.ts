import { parseProjectManifestFlowStep } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { getDesktopApi } from '@/platform/desktop'
import { mutateProjectManifest } from '@/api/projectManifest'
import { discoverProjectForWorkspace } from '@/utils/projectManagementRead'

export interface ProjectRouteContext {
  projectRoot: string
  projectName?: string
}

export interface ProjectManagedWorkspaceRegistrationInput {
  workspacePath: string
  config?: WorkspaceConfig
  projectContext?: ProjectRouteContext | null
  routeQuery?: Record<string, unknown>
  onWarning?: (summary: string, detail: string) => void
}

export function projectContextFromWorkspaceConfig(
  config: WorkspaceConfig,
): ProjectRouteContext | null {
  const projectContext = config.project_context
  if (!projectContext || typeof projectContext !== 'object') return null

  const projectRoot =
    typeof projectContext.project_root === 'string'
      ? normalizePath(projectContext.project_root)
      : ''
  if (!projectRoot) return null

  return {
    projectRoot,
    projectName:
      typeof projectContext.project_name === 'string'
        ? projectContext.project_name
        : undefined,
  }
}

export function workspaceRouteQueryFromProjectContext(
  workspacePath: string,
  projectContext: ProjectRouteContext | null,
): Record<string, string> {
  const projectRoot = normalizePath(projectContext?.projectRoot ?? '')
  if (!projectRoot) return {}
  const projectName = projectContext?.projectName?.trim() ?? ''
  const workspaceId = basenamePath(workspacePath)
  return {
    projectRoot,
    ...(projectName ? { projectName } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  }
}

/**
 * Infers the parent project for a workspace opened outside Project Management
 * (for example Backend Design recent workspaces) when the parent directory has a
 * project.json that already lists that workspace.
 */
export async function resolveProjectRouteContextForWorkspace(
  workspacePath: string,
): Promise<ProjectRouteContext | null> {
  const normalizedWorkspace = normalizePath(workspacePath)
  if (!normalizedWorkspace) return null

  try {
    const manifest = await discoverProjectForWorkspace(normalizedWorkspace)
    if (!manifest) return null
    const projectRoot = normalizePath(manifest.root_path)
    const listed = manifest.workspaces.some(
      (workspace) => normalizePath(workspace.workspace_path) === normalizedWorkspace,
    )
    if (!listed) return null

    return {
      projectRoot,
      projectName: manifest.name || basenamePath(projectRoot) || undefined,
    }
  } catch (error) {
    console.warn('Failed to resolve project context for workspace.', error)
    return null
  }
}

/**
 * Resolve the managed project that should own a workspace path.
 * Prefers an explicit context (tab/route); otherwise uses the parent directory
 * only when it already contains project.json (avoids inventing a project).
 */
export async function resolveManagedProjectContext(options: {
  preferred?: ProjectRouteContext | null
  workspacePath: string
}): Promise<ProjectRouteContext | null> {
  const preferredRoot = normalizePath(options.preferred?.projectRoot ?? '')
  if (preferredRoot) {
    return {
      projectRoot: preferredRoot,
      projectName:
        optionalString(options.preferred?.projectName) ||
        basenamePath(preferredRoot) ||
        undefined,
    }
  }

  return await resolveProjectRouteContextForWorkspace(options.workspacePath)
}

export async function registerProjectManagedWorkspace(
  input: ProjectManagedWorkspaceRegistrationInput,
): Promise<void> {
  const projectRoot =
    input.projectContext?.projectRoot || queryString(input.routeQuery?.projectRoot)
  const workspacePath = normalizePath(input.workspacePath)
  if (!projectRoot || !workspacePath) return

  const warn = input.onWarning ?? (() => {})
  let registeredProjectRoot: string | null = null

  try {
    registeredProjectRoot = await registerLocalProjectRoot(projectRoot)
    if (!registeredProjectRoot) {
      warn(
        'Project manifest not updated',
        'Workspace was created. The project root could not be registered, so project.json was not updated.',
      )
      return
    }

    const projectName =
      input.projectContext?.projectName ||
      queryString(input.routeQuery?.projectName) ||
      basenamePath(registeredProjectRoot) ||
      'project'
    await mutateProjectManifest(registeredProjectRoot, {
      type: 'register-workspace',
      input: {
        projectRoot: registeredProjectRoot,
        projectName,
        workspacePath,
        sourceWorkspaceId: queryString(input.routeQuery?.sourceWorkspace) || undefined,
        sourceStep: canonicalManifestStep(queryString(input.routeQuery?.sourceStep)),
        sourceOutputPath: queryString(input.routeQuery?.sourceOutputPath) || undefined,
        sourceOutputType: queryString(input.routeQuery?.sourceOutputType) || undefined,
        startStep: canonicalManifestStep(
          queryString(input.routeQuery?.startStep) ||
            optionalString(input.config?.flow_config?.start_step),
        ),
        endStep: canonicalManifestStep(
          queryString(input.routeQuery?.endStep) ||
            optionalString(input.config?.flow_config?.end_step),
        ),
        config: input.config,
      },
    })
  } catch (error) {
    console.warn('Failed to update project manifest after workspace creation.', error)
    warn('Project manifest not updated', projectManifestUpdateFailureDetail(error))
  } finally {
    const registeredWorkspaceRoot = await registerLocalProjectRoot(workspacePath)
    if (registeredProjectRoot && registeredWorkspaceRoot) {
      try {
        const desktopApi = getDesktopApi()
        await desktopApi.workspace.registerProjectReadRoot(registeredProjectRoot)
      } catch (error) {
        console.warn('Failed to register managed project read scope:', error)
      }
    }
  }
}

async function registerLocalProjectRoot(rootPath: string): Promise<string | null> {
  try {
    const desktopApi = getDesktopApi()
    const registeredRoot = await desktopApi.workspace.registerProjectRoot(rootPath)
    return normalizePath(registeredRoot || rootPath)
  } catch (error) {
    console.warn('Failed to register project root for manifest update.', error)
    return null
  }
}

function canonicalManifestStep(value: string): string | undefined {
  if (!value) return undefined
  const canonical = parseProjectManifestFlowStep(value)
  if (!canonical) {
    throw new Error(
      `Flow step "${value}" is not a canonical project.json step. Use names such as Synth or Harden.`,
    )
  }
  return canonical
}

function projectManifestUpdateFailureDetail(error: unknown): string {
  const reason =
    error instanceof Error && error.message.trim() ? error.message.trim() : String(error)
  return `Workspace was created. project.json was not updated: ${reason}`
}

function queryString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function optionalString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function basenamePath(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? ''
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) return normalized.slice(0, -1)
  return normalized
}
