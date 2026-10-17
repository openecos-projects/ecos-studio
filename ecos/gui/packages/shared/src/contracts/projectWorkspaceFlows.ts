import type { ProjectStepStatus } from './backendProjectComparison.ts'

export interface ProjectWorkspaceFlowsRequest {
  projects: Array<{ projectRoot: string; workspaceIds: string[] }>
}

export interface ProjectWorkspaceFlowState {
  steps: Record<string, ProjectStepStatus>
  running: boolean
  issue?: 'unavailable' | 'interrupted'
}

export type ProjectWorkspaceFlows = Record<
  string,
  Record<string, ProjectWorkspaceFlowState>
>
