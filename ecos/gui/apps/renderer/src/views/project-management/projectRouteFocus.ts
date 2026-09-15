export interface ProjectRouteFocusCandidate {
  id: string
  path: string
  workspaces: Array<{ id: string; path?: string }>
}

export interface ProjectRouteFocusInput {
  projectRoot?: string | null
  workspaceId?: string | null
  workspacePath?: string | null
  projects: readonly ProjectRouteFocusCandidate[]
}

export interface ProjectRouteFocus {
  projectId: string
  workspaceId: string | null
}

/**
 * Resolves which project/workspace Project Management should select when the
 * route carries focus hints from "Back to Project Management".
 */
export function resolveProjectManagementRouteFocus(
  input: ProjectRouteFocusInput,
): ProjectRouteFocus | null {
  const projectRoot = normalizePath(input.projectRoot)
  const workspacePath = normalizePath(input.workspacePath)
  let workspaceId = asNonEmpty(input.workspaceId)
  if (!projectRoot && !workspaceId && !workspacePath) return null

  let project =
    projectRoot != null
      ? input.projects.find(
          (candidate) =>
            normalizePath(candidate.path) === projectRoot ||
            normalizePath(candidate.id) === projectRoot,
        )
      : undefined

  if (!project && workspaceId) {
    project = input.projects.find((candidate) =>
      candidate.workspaces.some((workspace) => workspace.id === workspaceId),
    )
  }

  if (!project && workspacePath) {
    project = input.projects.find((candidate) =>
      candidate.workspaces.some(
        (workspace) => normalizePath(workspace.path) === workspacePath,
      ),
    )
    workspaceId =
      project?.workspaces.find(
        (workspace) => normalizePath(workspace.path) === workspacePath,
      )?.id ?? null
  }

  if (!project) return null

  const focusedWorkspace =
    workspaceId && project.workspaces.some((workspace) => workspace.id === workspaceId)
      ? workspaceId
      : null

  return {
    projectId: project.id,
    workspaceId: focusedWorkspace,
  }
}

function asNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '').trim()
  return normalized || null
}
