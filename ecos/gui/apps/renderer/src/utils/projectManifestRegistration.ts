import type { WorkspaceConfig } from '@/types'
import { waitForDesktopApi } from '@/platform/desktop'
import { mutateProjectManifest } from '@/api/projectManifest'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { parseProjectManifest } from '@/utils/projectManagement'

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

  const projectRoot = parentPath(normalizedWorkspace)
  if (!projectRoot || projectRoot === normalizedWorkspace) return null

  try {
    const registeredProjectRoot = await registerLocalProjectRoot(projectRoot)
    if (!registeredProjectRoot) return null

    const manifestText = await readOptionalProjectTextFile('project.json', {
      projectPath: registeredProjectRoot,
    })
    if (!manifestText) return null

    const manifest = parseProjectManifest(manifestText)
    const listed = manifest.workspaces.some(
      (workspace) => normalizePath(workspace.workspace_path) === normalizedWorkspace,
    )
    if (!listed) return null

    return {
      projectRoot: registeredProjectRoot,
      projectName: manifest.name || basenamePath(registeredProjectRoot) || undefined,
    }
  } catch (error) {
    console.warn('Failed to resolve project context for workspace.', error)
    return null
  } finally {
    await registerLocalProjectRoot(normalizedWorkspace)
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

  const workspacePath = normalizePath(options.workspacePath)
  if (!workspacePath) return null
  const projectRoot = parentPath(workspacePath)
  if (!projectRoot || projectRoot === workspacePath) return null

  const registeredRoot = await registerLocalProjectRoot(projectRoot)
  if (!registeredRoot) return null

  const manifestText = await readOptionalProjectTextFile(
    joinPath(registeredRoot, 'project.json'),
  )
  if (!manifestText) return null

  let projectName = basenamePath(registeredRoot) || undefined
  try {
    const manifest = JSON.parse(manifestText) as { name?: unknown }
    if (typeof manifest.name === 'string' && manifest.name.trim()) {
      projectName = manifest.name.trim()
    }
  } catch {
    // Keep directory basename when the manifest is not JSON-parsable.
  }

  return { projectRoot: registeredRoot, projectName }
}

export async function registerProjectManagedWorkspace(
  input: ProjectManagedWorkspaceRegistrationInput,
): Promise<void> {
  const projectRoot =
    input.projectContext?.projectRoot || queryString(input.routeQuery?.projectRoot)
  const workspacePath = normalizePath(input.workspacePath)
  if (!projectRoot || !workspacePath) return

  const warn = input.onWarning ?? (() => {})

  try {
    const registeredProjectRoot = await registerLocalProjectRoot(projectRoot)
    if (!registeredProjectRoot) {
      warn(
        'Project manifest not updated',
        'Workspace was created, but the project root could not be registered for manifest access.',
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
        sourceStep: queryString(input.routeQuery?.sourceStep) || undefined,
        sourceOutputPath: queryString(input.routeQuery?.sourceOutputPath) || undefined,
        sourceOutputType: queryString(input.routeQuery?.sourceOutputType) || undefined,
        startStep:
          queryString(input.routeQuery?.startStep) ||
          optionalString(input.config?.flow_config?.start_step) ||
          undefined,
        endStep:
          queryString(input.routeQuery?.endStep) ||
          optionalString(input.config?.flow_config?.end_step) ||
          undefined,
        config: input.config,
      },
    })
  } catch (error) {
    console.warn('Failed to update project manifest after workspace creation.', error)
    warn(
      'Project manifest not updated',
      'Workspace was created, but project.json could not be updated.',
    )
  } finally {
    await registerLocalProjectRoot(workspacePath)
  }
}

async function registerLocalProjectRoot(rootPath: string): Promise<string | null> {
  try {
    const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
    const registeredRoot = await desktopApi.workspace.registerProjectRoot(rootPath)
    return normalizePath(registeredRoot || rootPath)
  } catch (error) {
    console.warn('Failed to register project root for manifest update.', error)
    return null
  }
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

function parentPath(path: string): string {
  const normalized = normalizePath(path)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return normalized.startsWith('/') ? '/' : ''
  const parent = parts.slice(0, -1).join('/')
  return normalized.startsWith('/') ? `/${parent}` : parent
}

function joinPath(root: string, child: string): string {
  return `${normalizePath(root)}/${child.replace(/^\/+/, '')}`
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) return normalized.slice(0, -1)
  return normalized
}
