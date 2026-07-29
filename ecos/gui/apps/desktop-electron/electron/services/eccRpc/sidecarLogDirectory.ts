import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve where an ECC sidecar should write its stderr log.
 *
 * ECC `create_workspace` rejects any non-empty target directory. The sidecar
 * starts (and may create its log file) before `workspace.create` returns, so
 * we must not write into `<directory>/log` until the workspace has been
 * materialized (`home/` present). Until then, return null so the sidecar falls
 * back to a temp directory.
 */
export function resolveEccSidecarLogDirectory(
  workspaceDirectory: string | null | undefined,
): string | null {
  if (!workspaceDirectory) {
    return null
  }
  if (!existsSync(join(workspaceDirectory, 'home'))) {
    return null
  }
  return join(workspaceDirectory, 'log')
}
