import { join } from 'node:path'

/**
 * Resolve where ECC sidecars write their stderr logs.
 *
 * Sidecar diagnostics are desktop-process artifacts, not workspace artifacts.
 * Keeping them outside a workspace lets ECC remove stale flow outputs during a
 * rerun without racing the still-running sidecar.
 */
export function resolveEccSidecarLogDirectory(logSessionDirectory: string): string {
  return join(logSessionDirectory, 'ecc-rpc')
}
