import { getDesktopApi } from '@/platform/desktop'

/**
 * Ask the desktop bridge to authorize a concrete file or directory path under the
 * currently registered project root. Returns false when the project has been
 * closed/switched or when the path is outside the active workspace scope.
 */
export async function resolveProjectPathAccess(path: string): Promise<string | null> {
  if (!path) return null

  try {
    return await getDesktopApi().workspace.requestProjectPathAccess(path)
  } catch (error) {
    console.warn(`Failed to request file access permission for ${path}:`, error)
    return null
  }
}

export async function requestProjectPathAccess(path: string): Promise<boolean> {
  return (await resolveProjectPathAccess(path)) !== null
}
