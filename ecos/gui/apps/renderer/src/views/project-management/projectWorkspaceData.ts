import type { ProjectManifest, ProjectManifestType } from '@ecos-studio/shared'
import type {
  ProjectWorkspaceAnalysisInputsById,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import { readProjectManagementWorkspaceData } from './projectWorkspaceAnalysisData'
import { readFrontendProjectWorkspaceFlowStates } from './frontendProjectWorkspaceData'

export interface ProjectWorkspaceDataReader {
  readAnalysisInputs(
    projectRoot: string,
    manifest: ProjectManifest,
  ): Promise<ProjectWorkspaceAnalysisInputsById>
  readFlowStates(
    projectRoot: string,
    manifest: ProjectManifest,
  ): Promise<ProjectWorkspaceFlowStatesById>
}

const backendProjectWorkspaceDataReader: ProjectWorkspaceDataReader = {
  readAnalysisInputs: async (projectRoot, manifest) =>
    (await readProjectManagementWorkspaceData(projectRoot, manifest)).analysisInputs,
  readFlowStates: async (projectRoot, manifest) =>
    (await readProjectManagementWorkspaceData(projectRoot, manifest)).flowStates,
}

const frontendProjectWorkspaceDataReader: ProjectWorkspaceDataReader = {
  readAnalysisInputs: emptyWorkspaceEntries,
  readFlowStates: readFrontendProjectWorkspaceFlowStates,
}

const projectWorkspaceDataReaders: Record<
  ProjectManifestType,
  ProjectWorkspaceDataReader
> = {
  backend: backendProjectWorkspaceDataReader,
  frontend: frontendProjectWorkspaceDataReader,
}

export function projectWorkspaceDataReaderFor(
  projectType: ProjectManifestType,
): ProjectWorkspaceDataReader {
  return projectWorkspaceDataReaders[projectType]
}

export async function readProjectWorkspaceFlowStates(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceFlowStatesById> {
  return await projectWorkspaceDataReaderFor(manifest.project_type).readFlowStates(
    projectRoot,
    manifest,
  )
}

export async function readProjectWorkspaceAnalysisInputs(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceAnalysisInputsById> {
  return await projectWorkspaceDataReaderFor(manifest.project_type).readAnalysisInputs(
    projectRoot,
    manifest,
  )
}

async function emptyWorkspaceEntries(
  _projectRoot: string,
  manifest: ProjectManifest,
): Promise<Record<string, Record<string, never>>> {
  return Object.fromEntries(
    manifest.workspaces.map((workspace) => [workspace.workspace_id, {}]),
  )
}
