import type {
  FlowStep,
  ProjectManifest,
  ProjectWorkspaceAnalysisInput,
  ProjectWorkspaceAnalysisInputsById,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import { parseWorkspaceFlowStateMap } from '@/utils/projectManagement'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'

const WORKSPACE_STEP_ANALYSIS_SPECS: Array<{
  step: FlowStep
  metricsPath: string
  summaryPath: string
  hotspotsPath: string
}> = [
  {
    step: 'Synth',
    metricsPath: 'Synthesis_yosys/analysis/qor_metrics.json',
    summaryPath: 'Synthesis_yosys/analysis/qor_summary.json',
    hotspotsPath: 'Synthesis_yosys/analysis/qor_hotspots.json',
  },
  {
    step: 'Floor',
    metricsPath: 'Floorplan_ecc/analysis/qor_metrics.json',
    summaryPath: 'Floorplan_ecc/analysis/qor_summary.json',
    hotspotsPath: 'Floorplan_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'Fanout',
    metricsPath: 'fixFanout_ecc/analysis/qor_metrics.json',
    summaryPath: 'fixFanout_ecc/analysis/qor_summary.json',
    hotspotsPath: 'fixFanout_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'Place',
    metricsPath: 'place_dreamplace/analysis/qor_metrics.json',
    summaryPath: 'place_dreamplace/analysis/qor_summary.json',
    hotspotsPath: 'place_dreamplace/analysis/qor_hotspots.json',
  },
  {
    step: 'CTS',
    metricsPath: 'CTS_ecc/analysis/qor_metrics.json',
    summaryPath: 'CTS_ecc/analysis/qor_summary.json',
    hotspotsPath: 'CTS_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'Legal',
    metricsPath: 'legalization_dreamplace/analysis/qor_metrics.json',
    summaryPath: 'legalization_dreamplace/analysis/qor_summary.json',
    hotspotsPath: 'legalization_dreamplace/analysis/qor_hotspots.json',
  },
  {
    step: 'Route',
    metricsPath: 'route_ecc/analysis/qor_metrics.json',
    summaryPath: 'route_ecc/analysis/qor_summary.json',
    hotspotsPath: 'route_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'DRC',
    metricsPath: 'drc_ecc/analysis/qor_metrics.json',
    summaryPath: 'drc_ecc/analysis/qor_summary.json',
    hotspotsPath: 'drc_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'Filler',
    metricsPath: 'filler_ecc/analysis/qor_metrics.json',
    summaryPath: 'filler_ecc/analysis/qor_summary.json',
    hotspotsPath: 'filler_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'RCX',
    metricsPath: 'RCX_ecc/analysis/qor_metrics.json',
    summaryPath: 'RCX_ecc/analysis/qor_summary.json',
    hotspotsPath: 'RCX_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'STA',
    metricsPath: 'sta_ecc/analysis/qor_metrics.json',
    summaryPath: 'sta_ecc/analysis/qor_summary.json',
    hotspotsPath: 'sta_ecc/analysis/qor_hotspots.json',
  },
  {
    step: 'Harden',
    metricsPath: 'Harden_ecc/analysis/qor_metrics.json',
    summaryPath: 'Harden_ecc/analysis/qor_summary.json',
    hotspotsPath: 'Harden_ecc/analysis/qor_hotspots.json',
  },
]

const STA_TIMING_ISSUES_PATH = 'sta_ecc/analysis/sta_timing_issues.json'
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
