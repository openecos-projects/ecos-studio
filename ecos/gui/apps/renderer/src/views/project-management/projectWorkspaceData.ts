import type { ProjectManifest, ProjectManifestType } from '@ecos-studio/shared'
import type {
  ProjectWorkspaceAnalysisInputsById,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import { readProjectManagementWorkspaceData } from './projectWorkspaceAnalysisData'
import { readFrontendProjectWorkspaceData } from './frontendProjectWorkspaceData'

export interface ProjectWorkspaceData {
  analysisInputs: ProjectWorkspaceAnalysisInputsById
  flowStates: ProjectWorkspaceFlowStatesById
}

export interface ProjectWorkspaceDataReader {
  readData(projectRoot: string, manifest: ProjectManifest): Promise<ProjectWorkspaceData>
}

const backendProjectWorkspaceDataReader: ProjectWorkspaceDataReader = {
  readData: readProjectManagementWorkspaceData,
}

const frontendProjectWorkspaceDataReader: ProjectWorkspaceDataReader = {
  readData: readFrontendProjectWorkspaceData,
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
  return (await readProjectWorkspaceData(projectRoot, manifest)).flowStates
}

export async function readProjectWorkspaceAnalysisInputs(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceAnalysisInputsById> {
  return (await readProjectWorkspaceData(projectRoot, manifest)).analysisInputs
}

export async function readProjectWorkspaceData(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceData> {
  return await projectWorkspaceDataReaderFor(manifest.project_type).readData(
    projectRoot,
    manifest,
  )
}
