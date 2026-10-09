import type { DesktopAgentPdkInstallation } from '@ecos-studio/shared'
import { listPdkInstallationsApi } from '@/api/plugin'

/**
 * PDK choices offered to the agent workspace setup wizard: the same inventory
 * the New Workspace wizard lists (Resource Manager downloads plus local
 * imports), limited to installations the wizard would mark eligible.
 */
export async function loadAgentPdkInstallations(): Promise<
  DesktopAgentPdkInstallation[]
> {
  let installations
  try {
    installations = await listPdkInstallationsApi()
  } catch {
    return []
  }
  return installations
    .filter(
      (installation) =>
        installation.readiness === 'ready' || installation.readiness === 'unverified',
    )
    .map((installation) => ({
      name: installation.displayName,
      path: installation.root,
      source: installation.ownership,
      ...(installation.version ? { version: installation.version } : {}),
    }))
}
