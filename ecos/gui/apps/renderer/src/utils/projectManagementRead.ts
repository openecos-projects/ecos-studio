import { getDesktopApi } from '@/platform/desktop'
import type { DesktopProjectManagementWorkspaceTextsResult } from '@ecos-studio/shared'

function projectManagementApi() {
  const api = getDesktopApi().projectManagement
  if (!api) {
    throw new Error('Project management reads are unavailable in this desktop build.')
  }
  return api
}

export async function readProjectManagementManifest(
  projectRoot: string,
): Promise<string | null> {
  return await projectManagementApi().readManifest(projectRoot)
}

export async function listProjectManagementEntries(
  projectRoot: string,
): Promise<string[]> {
  return await projectManagementApi().listProjectEntries(projectRoot)
}

export async function readProjectManagementWorkspaceTexts(
  projectRoot: string,
  workspacePath: string,
  paths: string[],
): Promise<DesktopProjectManagementWorkspaceTextsResult> {
  return await projectManagementApi().readWorkspaceTexts({
    projectRoot,
    workspacePath,
    paths,
  })
}
