export * from '../backendProjectManagement'
export type {
  ProjectFlowStatusHint,
  ProjectManagementProject,
  ProjectSelectionState,
  ProjectStage,
  ProjectStepCell,
  ProjectWorkspace,
} from './model'

import type { ProjectManifest } from '@ecos-studio/shared'
import type { Project } from '@/types'
import {
  FLOW_STEPS,
  buildProjectManagementProject as buildBackendProjectManagementProject,
  type ProjectSelectionUpdateMode,
  type ProjectWorkspaceAnalysisInputsById,
  type ProjectWorkspaceFlowStatesById,
} from '../backendProjectManagement'
import { buildFrontendProjectManagementProject } from './frontendProjectManagement'
import { buildFrontendProjectAnalysis } from '@/views/project-management/frontendProjectAnalysis'
export { FRONTEND_FLOW_STEPS } from './frontendProjectManagement'
import type { ProjectManagementProject, ProjectSelectionState } from './model'

export function buildProjectManagementProject(
  project?: Project | null,
  manifest?: ProjectManifest | null,
  workspaceFlowStates: ProjectWorkspaceFlowStatesById = {},
  workspaceAnalysisInputs: ProjectWorkspaceAnalysisInputsById = {},
): ProjectManagementProject {
  if (manifest?.project_type === 'frontend') {
    return buildFrontendProjectManagementProject(
      project,
      manifest,
      workspaceFlowStates,
      workspaceAnalysisInputs,
    )
  }
  if (!manifest && project?.projectType === 'frontend') {
    return {
      ...buildBackendProjectManagementProject(project, null),
      projectType: 'frontend',
      flowSteps: ['prepare', 'review', 'elab', 'lint', 'sim'],
      frontendAnalysis: buildFrontendProjectAnalysis([]),
    }
  }
  return {
    ...buildBackendProjectManagementProject(
      project,
      manifest,
      workspaceFlowStates,
      workspaceAnalysisInputs,
    ),
    flowSteps: FLOW_STEPS,
    frontendAnalysis: null,
  }
}

export function createSelectionState(
  project: ProjectManagementProject,
): ProjectSelectionState {
  return {
    selectedWorkspaceId: project.bestWorkspaceId || project.workspaces[0]?.id || '',
    selectedStep:
      project.projectType === 'frontend'
        ? (project.flowSteps[project.flowSteps.length - 1] ?? 'sim')
        : 'DRC',
  }
}

export function resolveProjectSelectionUpdate(
  previousProjectKey: string | null,
  project: ProjectManagementProject,
  currentWorkspaceId: string,
  requestedWorkspaceId?: string,
): {
  nextProjectKey: string
  mode: ProjectSelectionUpdateMode
  selection?: ProjectSelectionState
  nextWorkspaceId?: string
} {
  const nextProjectKey = project.path || project.id
  if (nextProjectKey !== previousProjectKey) {
    const selection = createSelectionState(project)
    if (
      requestedWorkspaceId &&
      project.workspaces.some((workspace) => workspace.id === requestedWorkspaceId)
    ) {
      selection.selectedWorkspaceId = requestedWorkspaceId
    }
    return { nextProjectKey, mode: 'reset', selection }
  }
  const workspaceIds = project.workspaces.map((workspace) => workspace.id)
  if (currentWorkspaceId && workspaceIds.includes(currentWorkspaceId)) {
    return { nextProjectKey, mode: 'keep' }
  }
  return {
    nextProjectKey,
    mode: 'reconcile-workspace',
    nextWorkspaceId: project.bestWorkspaceId || project.workspaces[0]?.id || '',
  }
}
