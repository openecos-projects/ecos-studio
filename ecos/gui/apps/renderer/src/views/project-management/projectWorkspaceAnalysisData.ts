import type {
  FlowStep,
  ProjectFeatureFileKey,
  ProjectManifest,
  ProjectWorkspaceAnalysisInput,
  ProjectWorkspaceAnalysisInputsById,
  ProjectWorkspaceFlowStatesById,
} from '@/utils/projectManagement'
import { parseWorkspaceFlowStateMap } from '@/utils/projectManagement'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'

const WORKSPACE_ANALYSIS_FILE_SPECS: Array<{ key: ProjectFeatureFileKey; path: string }> =
  [
    { key: 'synthesisStat', path: 'Synthesis_yosys/feature/Synthesis_stat.json' },
    { key: 'floorplanDb', path: 'Floorplan_ecc/feature/Floorplan.db.json' },
    { key: 'fanoutDb', path: 'fixFanout_ecc/feature/fixFanout.db.json' },
    { key: 'fanoutStep', path: 'fixFanout_ecc/feature/fixFanout.step.json' },
    { key: 'placeDb', path: 'place_dreamplace/feature/place.db.json' },
    { key: 'placeMap', path: 'place_dreamplace/feature/place.map.json' },
    { key: 'ctsDb', path: 'CTS_ecc/feature/CTS.db.json' },
    { key: 'ctsStep', path: 'CTS_ecc/feature/CTS.step.json' },
    { key: 'ctsMap', path: 'CTS_ecc/feature/CTS.map.json' },
    { key: 'legalDb', path: 'legalization_dreamplace/feature/legalization.db.json' },
    { key: 'routeDb', path: 'route_ecc/feature/route.db.json' },
    { key: 'routeStep', path: 'route_ecc/feature/route.step.json' },
    { key: 'drcDb', path: 'drc_ecc/feature/drc.db.json' },
    { key: 'drcStep', path: 'drc_ecc/feature/drc.step.json' },
    { key: 'fillerDb', path: 'filler_ecc/feature/filler.db.json' },
    { key: 'fillerStep', path: 'filler_ecc/feature/filler.step.json' },
    { key: 'rcxDb', path: 'RCX_ecc/feature/RCX.db.json' },
    { key: 'staDb', path: 'sta_ecc/feature/sta.db.json' },
  ]

const WORKSPACE_STEP_METRICS_FILE_SPECS: Array<{ step: FlowStep; path: string }> = [
  { step: 'Synth', path: 'Synthesis_yosys/analysis/Synthesis_metrics.json' },
  { step: 'Floor', path: 'Floorplan_ecc/analysis/Floorplan_metrics.json' },
  { step: 'Fanout', path: 'fixFanout_ecc/analysis/fixFanout_metrics.json' },
  { step: 'Place', path: 'place_dreamplace/analysis/place_metrics.json' },
  { step: 'CTS', path: 'CTS_ecc/analysis/CTS_metrics.json' },
  { step: 'Legal', path: 'legalization_dreamplace/analysis/legalization_metrics.json' },
  { step: 'Route', path: 'route_ecc/analysis/route_metrics.json' },
  { step: 'DRC', path: 'drc_ecc/analysis/drc_metrics.json' },
  { step: 'Filler', path: 'filler_ecc/analysis/filler_metrics.json' },
  { step: 'RCX', path: 'RCX_ecc/analysis/RCX_metrics.json' },
  { step: 'STA', path: 'sta_ecc/analysis/sta_metrics.json' },
  { step: 'Harden', path: 'Harden_ecc/analysis/Harden_metrics.json' },
]

const STA_CORNER_PATHS = [
  'MAX_125/Cworst',
  'MAX_125/RCworst',
  'TYP_25/TYPICAL',
  'ML_125/Cworst',
  'ML_125/RCworst',
  'ML_125/Cbest',
  'ML_125/RCbest',
  'MIN_m40/Cworst',
  'MIN_m40/RCworst',
  'MIN_m40/Cbest',
  'MIN_m40/RCbest',
  'WCL_m40/Cworst',
  'WCL_m40/RCworst',
]

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
  const designName = normalizeArtifactDesignName(
    manifest.base_design.top_module || manifest.name || 'design',
  )
  const entries = await Promise.all(
    manifest.workspaces.map(async (workspace) => {
      try {
        return [
          workspace.workspace_id,
          await readWorkspaceAnalysisInput(workspace.workspace_path, designName),
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
  designName: string,
): Promise<ProjectWorkspaceAnalysisInput> {
  const [
    fileEntries,
    stepMetricEntries,
    staReports,
    flowText,
    checklistText,
    parametersText,
  ] = await Promise.all([
    Promise.all(
      WORKSPACE_ANALYSIS_FILE_SPECS.map(async (spec) => {
        const content = await readOptionalProjectTextFile(spec.path, {
          projectPath: workspacePath,
        })
        return [spec.key, content] as const
      }),
    ),
    Promise.all(
      WORKSPACE_STEP_METRICS_FILE_SPECS.map(async (spec) => {
        const content = await readOptionalProjectTextFile(spec.path, {
          projectPath: workspacePath,
        })
        return [spec.step, content] as const
      }),
    ),
    Promise.all(
      STA_CORNER_PATHS.map(async (corner) => {
        const content = await readOptionalProjectTextFile(
          `sta_ecc/output/${corner}/${designName}.rpt.json`,
          { projectPath: workspacePath },
        )
        return { corner, content }
      }),
    ),
    readOptionalProjectTextFile('home/flow.json', { projectPath: workspacePath }),
    readOptionalProjectTextFile('home/checklist.json', { projectPath: workspacePath }),
    readOptionalProjectTextFile('home/parameters.json', { projectPath: workspacePath }),
  ])

  return {
    files: Object.fromEntries(fileEntries),
    stepMetricTexts: Object.fromEntries(stepMetricEntries),
    staReports,
    flowText,
    checklistText,
    parametersText,
  }
}

function normalizeArtifactDesignName(value: string): string {
  return value.trim().replace(/[\\/]/g, '_').replace(/\s+/g, '_') || 'design'
}
