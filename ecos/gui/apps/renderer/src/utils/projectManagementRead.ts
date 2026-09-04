import { getDesktopApi } from '@/platform/desktop'
import type { DesktopProjectManagementWorkspaceTextsResult } from '@ecos-studio/shared'
import type { ProjectManifest } from '@ecos-studio/shared'

function projectManagementApi() {
  const api = getDesktopApi().projectManagement
  if (!api) {
    throw new Error('Project management reads are unavailable in this desktop build.')
  }
  return api
}

export async function readProjectManagementManifest(
  projectRoot: string,
): Promise<ProjectManifest | null> {
  return await projectManagementApi().readManifest(projectRoot)
}

export async function discoverProjectForWorkspace(
  directory: string,
): Promise<ProjectManifest | null> {
  return await projectManagementApi().discoverProject(directory)
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
