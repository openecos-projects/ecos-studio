export type AgentTabContextMode = 'home' | 'workspace'

export interface AgentTabContextInput {
  mode: AgentTabContextMode
  projectRoot?: string
  projectName?: string
  workspacePath?: string
  workspaceName?: string
  step?: string
}

export interface AgentTabTitleInput extends AgentTabContextInput {
  existingTitles: string[]
}

function baseName(path: string | undefined): string {
  if (!path) return ''
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || trimmed
}

export function resolveAgentTabTitle(input: AgentTabTitleInput): string {
  let base = 'New Agent'
  if (input.workspaceName?.trim()) {
    base = input.workspaceName.trim()
  } else if (input.workspacePath?.trim()) {
    base = baseName(input.workspacePath)
  } else if (input.projectName?.trim()) {
    base = input.projectName.trim()
  } else if (input.projectRoot?.trim()) {
    base = baseName(input.projectRoot)
  }

  if (input.workspacePath && input.step?.trim()) {
    base = `${base} · ${input.step.trim()}`
  }

  if (!input.existingTitles.includes(base)) return base
  let index = 2
  while (input.existingTitles.includes(`${base} (${index})`)) {
    index += 1
  }
  return `${base} (${index})`
}

export function existingTabIdForMode(
  tabs: ReadonlyArray<{ id: string; mode: AgentTabContextMode }>,
  mode: AgentTabContextMode,
  activeTabId?: string | null,
): string | undefined {
  if (activeTabId && tabs.some((tab) => tab.id === activeTabId && tab.mode === mode)) {
    return activeTabId
  }
  for (let i = tabs.length - 1; i >= 0; i -= 1) {
    if (tabs[i].mode === mode) return tabs[i].id
  }
  return undefined
}

export function resolveAgentTabContext(input: {
  shell: AgentTabContextMode
  currentWorkspacePath?: string | null
  currentWorkspaceName?: string | null
  currentProjectRoot?: string | null
  currentProjectName?: string | null
  routeProjectRoot?: string | null
  step?: string | null
}): AgentTabContextInput {
  const workspacePath =
    input.shell === 'workspace'
      ? input.currentWorkspacePath?.trim() || undefined
      : undefined
  if (workspacePath) {
    return {
      mode: 'workspace',
      workspacePath,
      workspaceName:
        input.currentWorkspaceName?.trim() || baseName(workspacePath) || undefined,
      projectRoot:
        input.currentProjectRoot?.trim() || input.routeProjectRoot?.trim() || undefined,
      projectName: input.currentProjectName?.trim() || undefined,
      step: input.step?.trim() || undefined,
    }
  }

  const projectRoot =
    input.currentProjectRoot?.trim() || input.routeProjectRoot?.trim() || undefined
  if (projectRoot) {
    return {
      mode: 'home',
      projectRoot,
      projectName: input.currentProjectName?.trim() || baseName(projectRoot) || undefined,
    }
  }

  return { mode: input.shell === 'workspace' ? 'workspace' : 'home' }
}
