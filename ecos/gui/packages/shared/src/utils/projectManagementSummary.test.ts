import { describe, expect, it } from 'vitest'
import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
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
