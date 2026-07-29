import { normalizeWorkspacePath } from './workspacePath'

export interface SecondInstanceHandlers {
  launchWindow(options?: { openWorkspacePath?: string }): Promise<void> | void
  openOrFocusPath?(path: string): Promise<'focused' | 'proceed'> | 'focused' | 'proceed'
  /**
   * Optional gate for argv candidates. When provided, non-workspace paths
   * (executables, app dirs, random absolute paths) open an empty Home window
   * instead of forcing a failed project open in the renderer.
   */
  isWorkspacePath?(path: string): Promise<boolean> | boolean
}

const IGNORED_PATH_SUFFIXES = [
  '.asar',
  '.cjs',
  '.css',
  '.dll',
  '.dylib',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.node',
  '.so',
  '.ts',
]

function isAbsolutePathCandidate(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

function isIgnoredPathCandidate(value: string): boolean {
  const lower = value.toLowerCase()
  if (IGNORED_PATH_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true
  }
  if (lower.includes('/node_modules/') || lower.includes('\\node_modules\\')) {
    return true
  }
  if (lower.endsWith('/electron') || lower.endsWith('\\electron')) {
    return true
  }
  if (lower.includes('/electron/') || lower.includes('\\electron\\')) {
    return true
  }
  return false
}

/**
 * Extract a workspace path from process argv.
 *
 * argv[0] is always the executable and must never be treated as a workspace.
 * Electron / electron-vite launches often include other absolute app paths that
 * are also not workspaces; callers should still validate with isWorkspacePath.
 */
export function extractWorkspacePathFromArgv(argv: readonly string[]): string | null {
  // Skip argv[0] (executable). When argv is empty/missing, start from the end.
  const startIndex = argv.length > 0 ? 1 : 0
  for (let index = argv.length - 1; index >= startIndex; index -= 1) {
    const candidate = argv[index]?.trim()
    if (!candidate || candidate.startsWith('-')) continue
    if (!isAbsolutePathCandidate(candidate)) continue
    if (isIgnoredPathCandidate(candidate)) continue
    return normalizeWorkspacePath(candidate)
  }
  return null
}

/**
 * VS Code-style second launch:
 * - If argv points at a workspace already open in a window, focus that window.
 * - Otherwise open a new window (empty Home, or Home that should open the given path).
 *
 * Electron still uses a single main process; the short-lived second process only
 * forwards the request and exits.
 */
export async function handleSecondInstance(
  argv: readonly string[],
  handlers: SecondInstanceHandlers,
): Promise<void> {
  const path = extractWorkspacePathFromArgv(argv)
  if (path) {
    const isWorkspace = handlers.isWorkspacePath
      ? await handlers.isWorkspacePath(path)
      : true
    if (isWorkspace) {
      if (handlers.openOrFocusPath) {
        const result = await handlers.openOrFocusPath(path)
        if (result === 'focused') {
          return
        }
      }
      await handlers.launchWindow({ openWorkspacePath: path })
      return
    }
  }

  await handlers.launchWindow()
}
