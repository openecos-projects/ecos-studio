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

export async function readProjectWorkspaceFlowStates(
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
          flowText ? parseWorkspaceFlowStateMap(flowText) : {},
        ] as const
      } catch (error) {
        console.warn(
          `Failed to load workspace flow.json: ${workspace.workspace_path}`,
          error,
        )
        return [workspace.workspace_id, {}] as const
      }
    }),
  )

  return Object.fromEntries(entries)
}

export async function readProjectWorkspaceAnalysisInputs(
  manifest: ProjectManifest,
): Promise<ProjectWorkspaceAnalysisInputsById> {
  const entries = await Promise.all(
    manifest.workspaces.map(async (workspace) => {
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
    }),
  )

  return Object.fromEntries(entries)
}

async function readWorkspaceAnalysisInput(
  workspacePath: string,
): Promise<ProjectWorkspaceAnalysisInput> {
  const [
    stepMetricEntries,
    stepSummaryEntries,
    stepHotspotEntries,
    staTimingIssuesText,
    flowText,
  ] = await Promise.all([
    Promise.all(
      WORKSPACE_STEP_ANALYSIS_SPECS.map(async (spec) => {
        const content = await readOptionalProjectTextFile(spec.metricsPath, {
          projectPath: workspacePath,
        })
        return [spec.step, content] as const
      }),
    ),
    Promise.all(
      WORKSPACE_STEP_ANALYSIS_SPECS.map(async (spec) => {
        const content = await readOptionalProjectTextFile(spec.summaryPath, {
          projectPath: workspacePath,
        })
        return [spec.step, content] as const
      }),
    ),
    Promise.all(
      WORKSPACE_STEP_ANALYSIS_SPECS.map(async (spec) => {
        const content = await readOptionalProjectTextFile(spec.hotspotsPath, {
          projectPath: workspacePath,
        })
        return [spec.step, content] as const
      }),
    ),
    readOptionalProjectTextFile(STA_TIMING_ISSUES_PATH, { projectPath: workspacePath }),
    readOptionalProjectTextFile('home/flow.json', { projectPath: workspacePath }),
  ])

  return {
    stepMetricTexts: Object.fromEntries(stepMetricEntries),
    stepSummaryTexts: Object.fromEntries(stepSummaryEntries),
    stepHotspotTexts: Object.fromEntries(stepHotspotEntries),
    staTimingIssuesText,
    flowText,
  }
}
