export interface RuntimeScope {
  directory?: string
  id: string
  workspaceId?: string
}

export const globalRuntimeScope = '__global__'

export function normalizeDirectoryScope(directory: string): string {
  const normalized = directory.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

export function workspaceRuntimeScope(directory: string): RuntimeScope {
  const normalized = normalizeDirectoryScope(directory)
  if (!normalized) return globalRuntimeScopeRecord()
  return {
    directory: normalized,
    id: normalized,
    workspaceId: normalized,
  }
}

export function globalRuntimeScopeRecord(): RuntimeScope {
  return {
    id: globalRuntimeScope,
  }
}
