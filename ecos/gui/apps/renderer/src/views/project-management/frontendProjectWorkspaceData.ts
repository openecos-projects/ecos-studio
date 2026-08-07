import type { ProjectManifest } from '@ecos-studio/shared'
import type {
  ProjectStepStatus,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'

export const FRONTEND_FLOW_STEPS = ['prepare', 'review', 'elab', 'lint', 'sim'] as const

export type FrontendFlowStep = (typeof FRONTEND_FLOW_STEPS)[number]
export type FrontendWorkspaceFlowStateMap = Partial<
  Record<FrontendFlowStep, ProjectStepStatus>
>

const frontendFlowStepSet = new Set<string>(FRONTEND_FLOW_STEPS)

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

export async function readFrontendProjectWorkspaceFlowStates(
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceFlowStatesById> {
  const entries = await Promise.all(
    manifest.workspaces.map(async (workspace) => {
      try {
        const flowText = await readOptionalProjectTextFile('home/flow.json', {
          projectPath: workspace.workspace_path,
        })
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
