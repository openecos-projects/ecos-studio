import type { WorkspaceConfig } from '@/types'
import { waitForDesktopApi } from '@/platform/desktop'
import {
  createProjectManifestDraft,
  parseProjectManifest,
  registerWorkspaceInManifest,
  serializeProjectManifest,
} from '@/utils/projectManagement'
import { readOptionalProjectTextFile, writeProjectTextFile } from '@/utils/projectFiles'

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
    const manifestText = await readOptionalProjectTextFile('project.json', {
      projectPath: registeredProjectRoot,
    })
    const manifest = manifestText
      ? parseProjectManifest(manifestText)
      : createProjectManifestDraft({ rootPath: registeredProjectRoot, name: projectName })
    const updated = registerWorkspaceInManifest(manifest, {
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
    })

    await writeProjectTextFile('project.json', serializeProjectManifest(updated), {
      projectPath: registeredProjectRoot,
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

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) return normalized.slice(0, -1)
  return normalized
}
