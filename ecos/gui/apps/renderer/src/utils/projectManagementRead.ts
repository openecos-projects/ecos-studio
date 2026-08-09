import { waitForDesktopApi } from '@/platform/desktop'

async function projectManagementApi() {
  const desktopApi = await waitForDesktopApi({ timeoutMs: 500 })
  if (!desktopApi.projectManagement) {
    throw new Error('Project management reads are unavailable in this desktop build.')
  }
  return desktopApi.projectManagement
}

export async function readProjectManagementManifest(
  projectRoot: string,
): Promise<string | null> {
  return await (await projectManagementApi()).readManifest(projectRoot)
}

export async function listProjectManagementEntries(projectRoot: string): Promise<string[]> {
  return await (await projectManagementApi()).listProjectEntries(projectRoot)
}

export async function readProjectManagementWorkspaceTexts(
  projectRoot: string,
  workspacePath: string,
  paths: string[],
): Promise<Record<string, string | null>> {
  return await (await projectManagementApi()).readWorkspaceTexts({
    projectRoot,
    workspacePath,
    paths,
  })
}
