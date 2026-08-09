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
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { readProjectManagementWorkspaceTexts } from '@/utils/projectManagementRead'

const WORKSPACE_STEP_ANALYSIS_SPECS = projectManagementWorkspaceStepAnalysisSpecs
const STA_TIMING_ISSUES_PATH = projectManagementStaTimingIssuesPath
const PROJECT_READ_CONCURRENCY = 2
const WORKSPACE_ANALYSIS_READ_CONCURRENCY = 4

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(Math.max(concurrency, 1), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(values[index]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

export async function readProjectWorkspaceFlowStates(
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceFlowStatesById> {
  const entries = await mapWithConcurrency(
    manifest.workspaces,
    PROJECT_READ_CONCURRENCY,
    async (workspace) => {
      try {
        const flowText = await readOptionalProjectTextFile('home/flow.json', {
          projectPath: workspace.workspace_path,
        })
        return [
          workspace.workspace_id,
          flowText ? parseWorkspaceFlowStateMap(flowText) : {},
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load workspace flow.json: ${workspace.workspace_path}`,
          error,
        )
        return [workspace.workspace_id, {}] as const
      }
    },
  )

  return Object.fromEntries(entries)
}

export async function readProjectWorkspaceAnalysisInputs(
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceAnalysisInputsById> {
  const entries = await mapWithConcurrency(
    manifest.workspaces,
    PROJECT_READ_CONCURRENCY,
    async (workspace) => {
      try {
        return [
          workspace.workspace_id,
          await readWorkspaceAnalysisInput(workspace.workspace_path),
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load workspace feature summary: ${workspace.workspace_path}`,
          error,
        )
        return [workspace.workspace_id, {}] as const
      }
    },
  )

  return Object.fromEntries(entries)
}

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
        const values = await readProjectManagementWorkspaceTexts(
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

async function readWorkspaceAnalysisInput(
  workspacePath: string,
): Promise<ProjectWorkspaceAnalysisInput> {
  const requests = [
    ...WORKSPACE_STEP_ANALYSIS_SPECS.map((spec) => ({
      key: `metrics:${spec.step}`,
      path: spec.metricsPath,
    })),
    ...WORKSPACE_STEP_ANALYSIS_SPECS.map((spec) => ({
      key: `summary:${spec.step}`,
      path: spec.summaryPath,
    })),
    ...WORKSPACE_STEP_ANALYSIS_SPECS.map((spec) => ({
      key: `hotspots:${spec.step}`,
      path: spec.hotspotsPath,
    })),
    { key: 'staTimingIssues', path: STA_TIMING_ISSUES_PATH },
    { key: 'flow', path: 'home/flow.json' },
  ] as const
  const loaded = await mapWithConcurrency(
    requests,
    WORKSPACE_ANALYSIS_READ_CONCURRENCY,
    async (request) =>
      [
        request.key,
        await readOptionalProjectTextFile(request.path, { projectPath: workspacePath }),
      ] as const,
  )
  const values = Object.fromEntries(loaded)
  const stepMetricEntries = WORKSPACE_STEP_ANALYSIS_SPECS.map(
    (spec) => [spec.step, values[`metrics:${spec.step}`] ?? null] as const,
  )
  const stepSummaryEntries = WORKSPACE_STEP_ANALYSIS_SPECS.map(
    (spec) => [spec.step, values[`summary:${spec.step}`] ?? null] as const,
  )
  const stepHotspotEntries = WORKSPACE_STEP_ANALYSIS_SPECS.map(
    (spec) => [spec.step, values[`hotspots:${spec.step}`] ?? null] as const,
  )

  return {
    stepMetricTexts: Object.fromEntries(stepMetricEntries),
    stepSummaryTexts: Object.fromEntries(stepSummaryEntries),
    stepHotspotTexts: Object.fromEntries(stepHotspotEntries),
    staTimingIssuesText: values.staTimingIssues ?? null,
    flowText: values.flow ?? null,
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
