import { describe, expect, it } from 'vitest'
import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceReadablePaths,
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManagementWorkspaceStepConfigPaths,
  projectManagementWorkspaceSummaryPaths,
} from './projectManagementSummary'

describe('projectManagementWorkspaceSummaryPaths', () => {
  it('is the unique bounded summary allowlist derived from every analysis step', () => {
    expect(projectManagementWorkspaceStepAnalysisSpecs).toHaveLength(13)
    expect(projectManagementWorkspaceStepAnalysisSpecs.map((spec) => spec.step)).toEqual(
      expect.arrayContaining(['DRC', 'LVS', 'Filler']),
    )
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find((spec) => spec.step === 'LVS'),
    ).toMatchObject({
      metricsPath: 'lvs_ecc/analysis/qor_metrics.json',
      summaryPath: 'lvs_ecc/analysis/qor_summary.json',
    })
    expect(projectManagementWorkspaceSummaryPaths).toContain('home/flow.json')
    expect(projectManagementWorkspaceSummaryPaths).toContain(
      projectManagementStaTimingIssuesPath,
    )
    expect(projectManagementWorkspaceSummaryPaths).toHaveLength(
      2 + projectManagementWorkspaceStepAnalysisSpecs.length * 3,
    )
    expect(new Set(projectManagementWorkspaceSummaryPaths).size).toBe(
      projectManagementWorkspaceSummaryPaths.length,
    )

    for (const spec of projectManagementWorkspaceStepAnalysisSpecs) {
      expect(projectManagementWorkspaceSummaryPaths).toEqual(
        expect.arrayContaining([spec.metricsPath, spec.summaryPath, spec.hotspotsPath]),
      )
    }
  })
})

describe('projectManagementWorkspaceStepConfigPaths', () => {
  it('lists the canonical step-config files plus their legacy pre-migration names', () => {
    expect(projectManagementWorkspaceStepConfigPaths).toEqual([
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
    ])
    expect(new Set(projectManagementWorkspaceStepConfigPaths).size).toBe(
      projectManagementWorkspaceStepConfigPaths.length,
    )
  })

  it('keeps the summary allowlist unchanged and merges it into the readable allowlist', () => {
    expect(projectManagementWorkspaceSummaryPaths).not.toContain('config/cts_ecc.json')
    expect(projectManagementWorkspaceReadablePaths).toHaveLength(
      projectManagementWorkspaceSummaryPaths.length +
        projectManagementWorkspaceStepConfigPaths.length,
    )
    expect(projectManagementWorkspaceReadablePaths).toEqual(
      expect.arrayContaining([
        ...projectManagementWorkspaceSummaryPaths,
        ...projectManagementWorkspaceStepConfigPaths,
      ]),
    )
    expect(new Set(projectManagementWorkspaceReadablePaths).size).toBe(
      projectManagementWorkspaceReadablePaths.length,
    )
  })
})
