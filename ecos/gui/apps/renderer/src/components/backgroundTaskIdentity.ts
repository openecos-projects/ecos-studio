export function backgroundTaskIdentityLabel(input: {
  owner?: string
  projectRoot?: string
  workspacePath: string
}): string {
  const workspacePath = normalizePath(input.workspacePath)
  const workspaceName = basename(workspacePath)
  if (!workspaceName) return input.workspacePath

  const owner =
    trim(input.owner) ||
    basename(normalizePath(input.projectRoot ?? '')) ||
    ownerFromWorkspacePath(workspacePath)
  if (!owner || owner === workspaceName) return workspaceName
  return `${owner} / ${workspaceName}`
}

export function ownerFromWorkspacePath(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  if (isGenericWorkspaceParent(parent) && parts.length >= 3) {
    return parts[parts.length - 3] ?? ''
  }
  return parent
}

function isGenericWorkspaceParent(name: string): boolean {
  return name.toLowerCase() === 'runs'
}

function basename(path: string): string {
  return normalizePath(path).split('/').filter(Boolean).pop() ?? ''
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/') && normalized.length > 1) return normalized.slice(0, -1)
  return normalized
}

function trim(value: string | undefined): string {
  return value?.trim() ?? ''
}
