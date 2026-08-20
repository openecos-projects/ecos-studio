import {
  projectManagementFrontendWorkspaceStepAnalysisSpecs,
  projectManagementFrontendWorkspaceSummaryPaths,
  type ProjectManifest,
} from '@ecos-studio/shared'
import type {
  ProjectWorkspaceAnalysisInputsById,
  ProjectStepStatus,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import { readProjectManagementWorkspaceTexts } from '@/utils/projectManagementRead'
import { mapWithConcurrency } from './asyncConcurrency'

export const FRONTEND_FLOW_STEPS = ['prepare', 'review', 'elab', 'lint', 'sim'] as const

export type FrontendFlowStep = (typeof FRONTEND_FLOW_STEPS)[number]
export type FrontendWorkspaceFlowStateMap = Partial<
  Record<FrontendFlowStep, ProjectStepStatus>
>

const frontendFlowStepSet = new Set<string>(FRONTEND_FLOW_STEPS)
const PROJECT_READ_CONCURRENCY = 2

export interface FrontendProjectWorkspaceData {
  analysisInputs: ProjectWorkspaceAnalysisInputsById
  flowStates: ProjectWorkspaceFlowStatesById
}

export function parseFrontendWorkspaceFlowStateMap(
  content: string,
): FrontendWorkspaceFlowStateMap {
  const parsed = JSON.parse(content) as {
    steps?: Array<{ name?: unknown; state?: unknown }>
  }
  if (!Array.isArray(parsed.steps)) return {}

  return parsed.steps.reduce<FrontendWorkspaceFlowStateMap>((stateMap, step) => {
    const name = frontendFlowStep(step.name)
    const status = frontendProjectStepStatus(step.state)
    if (name && status) stateMap[name] = status
    return stateMap
  }, {})
}

export async function readFrontendProjectWorkspaceData(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<FrontendProjectWorkspaceData> {
  const entries = await mapWithConcurrency(
    manifest.workspaces,
    PROJECT_READ_CONCURRENCY,
    async (workspace) => {
      try {
        const result = await readProjectManagementWorkspaceTexts(
          projectRoot,
          workspace.workspace_path,
          [...projectManagementFrontendWorkspaceSummaryPaths],
        )
        const flowText = result.texts['home/flow.json']
        return [
          workspace.workspace_id,
          {
            analysis: {
              frontendDetailTexts: Object.fromEntries(
                projectManagementFrontendWorkspaceStepAnalysisSpecs.map((spec) => [
                  spec.step,
                  result.texts[spec.detailPath] ?? null,
                ]),
              ),
              flowText: flowText ?? null,
            },
            flow: flowText ? parseFrontendWorkspaceFlowStateMap(flowText) : {},
          },
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load frontend workspace summary: ${workspace.workspace_path}`,
          error,
        )
        return [workspace.workspace_id, { analysis: {}, flow: {} }] as const
      }
    },
  )
  return {
    analysisInputs: Object.fromEntries(
      entries.map(([workspaceId, data]) => [workspaceId, data.analysis]),
    ),
    flowStates: Object.fromEntries(
      entries.map(([workspaceId, data]) => [workspaceId, data.flow]),
    ),
  }
}

export async function readFrontendProjectWorkspaceFlowStates(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceFlowStatesById> {
  return (await readFrontendProjectWorkspaceData(projectRoot, manifest)).flowStates
}

function frontendFlowStep(value: unknown): FrontendFlowStep | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return frontendFlowStepSet.has(normalized) ? (normalized as FrontendFlowStep) : null
}

function frontendProjectStepStatus(value: unknown): ProjectStepStatus | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'success') return 'success'
  if (normalized === 'ongoing' || normalized === 'pending') return 'running'
  if (normalized === 'incomplete' || normalized === 'invalid') return 'failed'
  if (normalized === 'unstart') return 'unstart'
  return null
}
