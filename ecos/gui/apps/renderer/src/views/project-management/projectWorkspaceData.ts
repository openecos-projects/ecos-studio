import type { ProjectManifest, ProjectManifestType } from '@ecos-studio/shared'
import type {
  ProjectWorkspaceAnalysisInputsById,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import { readProjectManagementWorkspaceTexts } from '@/utils/projectManagementRead'
import { readProjectManagementWorkspaceData } from './projectWorkspaceAnalysisData'

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

async function readFrontendProjectWorkspaceFlowStates(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceFlowStatesById> {
  const entries = await Promise.all(
    manifest.workspaces.map(async (workspace) => {
      try {
        const result = await readProjectManagementWorkspaceTexts(
          projectRoot,
          workspace.workspace_path,
          ['home/flow.json'],
        )
        const flowText = result.texts['home/flow.json']
        return [
          workspace.workspace_id,
          flowText ? parseFrontendWorkspaceFlowStateMap(flowText) : {},
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load frontend workspace flow.json: ${workspace.workspace_path}`,
          error,
        )
        return [workspace.workspace_id, {}] as const
      }
    }),
  )
  return Object.fromEntries(entries)
}

function parseFrontendWorkspaceFlowStateMap(
  content: string,
): Record<string, import('@/utils/projectManagement').ProjectStepStatus> {
  const parsed = JSON.parse(content) as {
    steps?: Array<{ name?: unknown; state?: unknown }>
  }
  if (!Array.isArray(parsed.steps)) return {}
  const allowed = new Set(['prepare', 'review', 'elab', 'lint', 'sim'])
  return parsed.steps.reduce<
    Record<string, import('@/utils/projectManagement').ProjectStepStatus>
  >((stateMap, step) => {
    const name = typeof step.name === 'string' ? step.name.trim().toLowerCase() : ''
    if (!allowed.has(name) || typeof step.state !== 'string') return stateMap
    const state = step.state.trim().toLowerCase()
    const status =
      state === 'success'
        ? 'success'
        : state === 'ongoing' || state === 'pending'
          ? 'running'
          : state === 'incomplete' || state === 'invalid'
            ? 'failed'
            : state === 'unstart'
              ? 'unstart'
              : null
    if (status) stateMap[name] = status
    return stateMap
  }, {})
}
