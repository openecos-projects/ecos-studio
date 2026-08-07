import type { ProjectManifest, ProjectManifestType } from '@ecos-studio/shared'
import type {
  ProjectWorkspaceAnalysisInputsById,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import {
  readBackendProjectWorkspaceAnalysisInputs,
  readBackendProjectWorkspaceFlowStates,
} from './projectWorkspaceAnalysisData'
import { readFrontendProjectWorkspaceFlowStates } from './frontendProjectWorkspaceData'

export interface ProjectWorkspaceDataReader {
  readAnalysisInputs(
    manifest: ProjectManifest,
  ): Promise<ProjectWorkspaceAnalysisInputsById>
  readFlowStates(manifest: ProjectManifest): Promise<ProjectWorkspaceFlowStatesById>
}

const backendProjectWorkspaceDataReader: ProjectWorkspaceDataReader = {
  readAnalysisInputs: readBackendProjectWorkspaceAnalysisInputs,
  readFlowStates: readBackendProjectWorkspaceFlowStates,
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
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceFlowStatesById> {
  return await projectWorkspaceDataReaderFor(manifest.project_type).readFlowStates(
    manifest,
  )
}

export async function readProjectWorkspaceAnalysisInputs(
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceAnalysisInputsById> {
  return await projectWorkspaceDataReaderFor(manifest.project_type).readAnalysisInputs(
    manifest,
  )
}

async function emptyWorkspaceEntries(
  manifest: ProjectManifest,
): Promise<Record<string, Record<string, never>>> {
  return Object.fromEntries(
    manifest.workspaces.map((workspace) => [workspace.workspace_id, {}]),
  )
}
