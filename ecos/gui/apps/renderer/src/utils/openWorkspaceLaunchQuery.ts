export interface OpenWorkspaceLaunchProject {
  id: string
  name: string
  path: string
  lastOpened: Date
}

export interface OpenWorkspaceLaunchQueryHandlers {
  openProject(
    project: OpenWorkspaceLaunchProject,
    options: { quiet: true },
  ): Promise<boolean>
  replaceWorkspaceRoute(): Promise<void>
  clearOpenWorkspaceQuery(): Promise<void>
}

function readOpenWorkspacePath(openWorkspaceQuery: unknown): string | null {
  const value = Array.isArray(openWorkspaceQuery)
    ? openWorkspaceQuery[0]
    : openWorkspaceQuery
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Handle a second-instance / deep-link `?openWorkspace=` launch query:
 * open the project quietly, then navigate to /workspace on success or strip
 * the query on failure.
 */
export async function consumeOpenWorkspaceLaunchQuery(
  openWorkspaceQuery: unknown,
  handlers: OpenWorkspaceLaunchQueryHandlers,
): Promise<boolean> {
  const workspacePath = readOpenWorkspacePath(openWorkspaceQuery)
  if (!workspacePath) {
    return false
  }

  const leafName = workspacePath.split('/').filter(Boolean).pop() || workspacePath
  const opened = await handlers.openProject(
    {
      id: workspacePath,
      name: leafName,
      path: workspacePath,
      lastOpened: new Date(),
    },
    { quiet: true },
  )

  if (opened) {
    await handlers.replaceWorkspaceRoute()
  } else {
    await handlers.clearOpenWorkspaceQuery()
  }
  return opened
}
