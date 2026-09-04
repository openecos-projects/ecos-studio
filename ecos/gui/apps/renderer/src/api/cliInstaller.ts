import { getDesktopApi } from '@/platform/desktop'
import type { CliInstallState, CliInstallerProgressEvent } from '@ecos-studio/shared'

export type { CliInstallState, CliInstallerProgressEvent }

export async function fetchCliInstallerStatus(): Promise<CliInstallState> {
  return getDesktopApi().cliInstaller.getStatus()
}

export async function installEccCli(): Promise<CliInstallState> {
  return getDesktopApi().cliInstaller.install()
}

export async function uninstallEccCli(): Promise<CliInstallState> {
  return getDesktopApi().cliInstaller.uninstall()
}

export function subscribeCliInstallerProgress(
  listener: (event: CliInstallerProgressEvent) => void,
): () => void {
  return getDesktopApi().cliInstaller.onProgress(listener)
}
