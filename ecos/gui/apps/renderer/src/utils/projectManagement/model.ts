import type { ProjectManifestStage, ProjectManifestType } from '@ecos-studio/shared'
import type {
  ProjectFlowStatusHint as BackendProjectFlowStatusHint,
  ProjectManagementProject as BackendProjectManagementProject,
  ProjectStepCell as BackendProjectStepCell,
  ProjectWorkspace as BackendProjectWorkspace,
} from '../backendProjectManagement'
import type { FrontendProjectAnalysis } from '@/views/project-management/frontendProjectAnalysis'

export type ProjectStage = ProjectManifestStage

export interface ProjectStepCell extends Omit<BackendProjectStepCell, 'step'> {
  step: ProjectStage
}

export interface ProjectFlowStatusHint extends Omit<
  BackendProjectFlowStatusHint,
  'step'
> {
  step?: ProjectStage
}

export interface ProjectWorkspace extends Omit<
  BackendProjectWorkspace,
  'branchStep' | 'endStep' | 'flowStatusHint' | 'startStep' | 'steps'
> {
  branchStep: ProjectStage | null
  startStep: ProjectStage
  endStep: ProjectStage
  flowStatusHint: ProjectFlowStatusHint
  steps: ProjectStepCell[]
}

export interface ProjectManagementProject extends Omit<
  BackendProjectManagementProject,
  'projectType' | 'workspaces'
> {
  projectType: ProjectManifestType
  flowSteps: readonly ProjectStage[]
  workspaces: ProjectWorkspace[]
  frontendAnalysis: FrontendProjectAnalysis | null
}

export interface ProjectSelectionState {
  selectedWorkspaceId: string
  selectedStep: ProjectStage
}
