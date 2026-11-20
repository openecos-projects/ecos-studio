export const projectManagementWorkspaceStepAnalysisSpecs = [
  {
    step: 'Synth',
    eccStepIds: ['synthesis'],
  },
  {
    step: 'Floor',
    eccStepIds: ['post_floorplan', 'pre_floorplan', 'macro_placement'],
  },
  {
    step: 'Place',
    eccStepIds: ['placement', 'preplace', 'diff_sizing'],
  },
  {
    step: 'CTS',
    eccStepIds: ['cts'],
  },
  {
    step: 'Legal',
    eccStepIds: ['legalization'],
  },
  {
    step: 'Timing Opt',
    eccStepIds: ['timing_optimization'],
  },
  {
    step: 'Route',
    eccStepIds: ['routing'],
  },
  {
    step: 'Filler',
    eccStepIds: ['filler'],
  },
  {
    step: 'LVS',
    eccStepIds: ['lvs'],
  },
  {
    step: 'DRC',
    eccStepIds: ['drc'],
  },
  {
    step: 'RCX',
    eccStepIds: ['rcx'],
  },
  {
    step: 'STA',
    eccStepIds: ['sta'],
  },
  {
    step: 'Power Analysis',
    eccStepIds: ['power_analysis'],
  },
  {
    step: 'Harden',
    eccStepIds: ['harden'],
  },
] as const

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

export type ProjectAnalysisArtifactKind =
  | 'qor_metrics'
  | 'qor_summary'
  | 'qor_hotspots'
  | 'sta_timing_issues'

export interface ProjectAnalysisArtifactPolicy {
  requiredKinds: readonly ProjectAnalysisArtifactKind[]
  optionalKinds: readonly ProjectAnalysisArtifactKind[]
}

/** Per-step artifact requirements shared by Electron main and the renderer. */
export function projectAnalysisArtifactPolicy(
  step: string,
): ProjectAnalysisArtifactPolicy {
  if (!projectManagementWorkspaceStepAnalysisSpecs.some((spec) => spec.step === step)) {
    return { requiredKinds: [], optionalKinds: [] }
  }
  return {
    requiredKinds:
      step === 'STA'
        ? ['qor_metrics', 'qor_summary', 'sta_timing_issues']
        : ['qor_metrics', 'qor_summary'],
    optionalKinds: ['qor_hotspots'],
  }
}
