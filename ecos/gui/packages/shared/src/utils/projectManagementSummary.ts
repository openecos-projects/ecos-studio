export const projectManagementWorkspaceStepAnalysisSpecs = [
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
    step: 'LVS',
    metricsPath: 'lvs_ecc/analysis/qor_metrics.json',
    summaryPath: 'lvs_ecc/analysis/qor_summary.json',
    hotspotsPath: 'lvs_ecc/analysis/qor_hotspots.json',
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
] as const

export const projectManagementStaTimingIssuesPath =
  'sta_ecc/analysis/sta_timing_issues.json'

export const projectManagementWorkspaceSummaryPaths = [
  'home/flow.json',
  ...projectManagementWorkspaceStepAnalysisSpecs.flatMap((spec) => [
    spec.metricsPath,
    spec.summaryPath,
    spec.hotspotsPath,
  ]),
  projectManagementStaTimingIssuesPath,
]

export const projectManagementFrontendWorkspaceStepAnalysisSpecs = [
  {
    step: 'prepare',
    detailPath: 'prepare_fe/report/frontend_detail.json',
    metricsPath: 'prepare_fe/analysis/qor_metrics.json',
    summaryPath: 'prepare_fe/analysis/qor_summary.json',
    hotspotsPath: 'prepare_fe/analysis/qor_hotspots.json',
  },
  {
    step: 'review',
    detailPath: 'review_fe/report/frontend_detail.json',
    metricsPath: 'review_fe/analysis/qor_metrics.json',
    summaryPath: 'review_fe/analysis/qor_summary.json',
    hotspotsPath: 'review_fe/analysis/qor_hotspots.json',
  },
  {
    step: 'elab',
    detailPath: 'elab_slang/report/frontend_detail.json',
    metricsPath: 'elab_slang/analysis/qor_metrics.json',
    summaryPath: 'elab_slang/analysis/qor_summary.json',
    hotspotsPath: 'elab_slang/analysis/qor_hotspots.json',
  },
  {
    step: 'lint',
    detailPath: 'lint_verilator/report/frontend_detail.json',
    metricsPath: 'lint_verilator/analysis/qor_metrics.json',
    summaryPath: 'lint_verilator/analysis/qor_summary.json',
    hotspotsPath: 'lint_verilator/analysis/qor_hotspots.json',
  },
  {
    step: 'sim',
    detailPath: 'sim_verilator/report/frontend_detail.json',
    metricsPath: 'sim_verilator/analysis/qor_metrics.json',
    summaryPath: 'sim_verilator/analysis/qor_summary.json',
    hotspotsPath: 'sim_verilator/analysis/qor_hotspots.json',
  },
] as const

export const projectManagementFrontendWorkspaceSummaryPaths = [
  'home/flow.json',
  ...projectManagementFrontendWorkspaceStepAnalysisSpecs.flatMap((spec) => [
    spec.detailPath,
    spec.metricsPath,
    spec.summaryPath,
    spec.hotspotsPath,
  ]),
]

export function projectManagementWorkspaceSummaryPathsFor(
  projectType: 'backend' | 'frontend',
): readonly string[] {
  return projectType === 'frontend'
    ? projectManagementFrontendWorkspaceSummaryPaths
    : projectManagementWorkspaceSummaryPaths
}

/**
 * Workspace step-config files read for the Step Configuration baseline comparison.
 * Mirrors workspaceResourceService config resources, including the legacy filenames
 * that only the active workspace migrates away from.
 */
export const projectManagementWorkspaceStepConfigPaths = [
  'config/floorplan_ecc.json',
  'config/cts_ecc.json',
  'config/route_ecc.json',
  'config/drc_ecc.json',
  'config/fixfanout_ecc.json',
  'config/filler_ecc.json',
  'config/rcx_ecc.json',
  'config/sta_ecc.json',
  'config/db_ecc.json',
  'config/dreamplace_ecc.json',
  'config/fp_default_config.json',
  'config/cts_default_config.json',
  'config/rt_default_config.json',
  'config/drc_default_config.json',
  'config/no_default_config_fixfanout.json',
  'config/pl_default_config.json',
  'config/rcx.json',
  'config/sta.json',
  'config/db_default_config.json',
  'config/dreamplace.json',
] as const

/** Every workspace-relative path projectManagement.readWorkspaceTexts may serve. */
export const projectManagementWorkspaceReadablePaths = [
  ...projectManagementWorkspaceSummaryPaths,
  ...projectManagementWorkspaceStepConfigPaths,
] as const

export function projectManagementWorkspaceReadablePathsFor(
  projectType: 'backend' | 'frontend',
): readonly string[] {
  return projectType === 'frontend'
    ? projectManagementFrontendWorkspaceSummaryPaths
    : projectManagementWorkspaceReadablePaths
}
