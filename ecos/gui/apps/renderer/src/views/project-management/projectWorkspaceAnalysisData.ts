import type {
  ProjectManifest,
  ProjectWorkspaceAnalysisInput,
  ProjectWorkspaceAnalysisInputsById,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManagementWorkspaceSummaryPaths,
} from '@ecos-studio/shared'
import { parseWorkspaceFlowStateMap } from '@/utils/projectManagement'
import { readProjectManagementWorkspaceTexts } from '@/utils/projectManagementRead'
import { mapWithConcurrency } from './asyncConcurrency'

const WORKSPACE_STEP_ANALYSIS_SPECS = projectManagementWorkspaceStepAnalysisSpecs
const STA_TIMING_ISSUES_PATH = projectManagementStaTimingIssuesPath
const PROJECT_READ_CONCURRENCY = 2

export async function readProjectManagementWorkspaceData(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<{
  analysisInputs: ProjectWorkspaceAnalysisInputsById
  flowStates: ProjectWorkspaceFlowStatesById
}> {
  const entries = await mapWithConcurrency(
    manifest.workspaces,
    PROJECT_READ_CONCURRENCY,
    async (workspace) => {
      try {
        const { texts: values } = await readProjectManagementWorkspaceTexts(
          projectRoot,
          workspace.workspace_path,
          projectManagementAnalysisPaths(),
        )
        const flowText = values['home/flow.json'] ?? null
        return [
          workspace.workspace_id,
          {
            analysis: analysisInputFromValues(values),
            flow: flowText ? parseWorkspaceFlowStateMap(flowText) : {},
          },
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load Project Management summary: ${workspace.workspace_path}`,
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

/**
 * Reads only the current/baseline workspaces used by Dashboard QoR. This keeps
 * GUI commit rendering off the renderer filesystem path and avoids a Project-
 * wide NFS fan-out for every completed step.
 */
export async function readProjectQorWorkspaceData(
  projectRoot: string,
  manifest: ProjectManifest,
  workspaceIds: readonly string[],
): Promise<{
  analysisInputs: ProjectWorkspaceAnalysisInputsById
  flowStates: ProjectWorkspaceFlowStatesById
  unavailableWorkspaceIds: string[]
}> {
  const requestedIds = new Set(workspaceIds)
  const workspaces = manifest.workspaces.filter((workspace) =>
    requestedIds.has(workspace.workspace_id),
  )
  const entries = await mapWithConcurrency(
    workspaces,
    PROJECT_READ_CONCURRENCY,
    async (workspace) => {
      try {
        const { texts: values } = await readProjectManagementWorkspaceTexts(
          projectRoot,
          workspace.workspace_path,
          projectManagementAnalysisPaths(),
        )
        const flowText = values['home/flow.json'] ?? null
        return [
          workspace.workspace_id,
          {
            analysis: analysisInputFromValues(values),
            flow: flowText ? parseWorkspaceFlowStateMap(flowText) : {},
            unavailable: false,
          },
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load Dashboard QoR input: ${workspace.workspace_path}`,
          error,
        )
        return [
          workspace.workspace_id,
          { analysis: {}, flow: {}, unavailable: true },
        ] as const
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
    unavailableWorkspaceIds: entries
      .filter(([, data]) => data.unavailable)
      .map(([workspaceId]) => workspaceId),
  }
}

function projectManagementAnalysisPaths(): string[] {
  return [...projectManagementWorkspaceSummaryPaths]
}

function analysisInputFromValues(
  values: Record<string, string | null>,
): ProjectWorkspaceAnalysisInput {
  return {
    stepMetricTexts: Object.fromEntries(
      WORKSPACE_STEP_ANALYSIS_SPECS.map((spec) => [
        spec.step,
        values[spec.metricsPath] ?? null,
      ]),
    ),
    stepSummaryTexts: Object.fromEntries(
      WORKSPACE_STEP_ANALYSIS_SPECS.map((spec) => [
        spec.step,
        values[spec.summaryPath] ?? null,
      ]),
    ),
    stepHotspotTexts: Object.fromEntries(
      WORKSPACE_STEP_ANALYSIS_SPECS.map((spec) => [
        spec.step,
        values[spec.hotspotsPath] ?? null,
      ]),
    ),
    staTimingIssuesText: values[STA_TIMING_ISSUES_PATH] ?? null,
    flowText: values['home/flow.json'] ?? null,
  }
}
