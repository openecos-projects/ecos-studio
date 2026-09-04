import { describe, expect, it } from 'vitest'
import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceReadablePaths,
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManagementWorkspaceSummaryPaths,
} from './projectManagementSummary'

describe('projectManagementWorkspaceSummaryPaths', () => {
  it('is the unique bounded summary allowlist derived from every analysis step', () => {
    expect(projectManagementWorkspaceStepAnalysisSpecs).toHaveLength(12)
    expect(projectManagementWorkspaceStepAnalysisSpecs.map((spec) => spec.step)).toEqual(
      expect.arrayContaining(['DRC', 'LVS', 'Filler']),
    )
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find((spec) => spec.step === 'LVS'),
    ).toMatchObject({
      metricsPath: 'lvs_ecc/analysis/qor_metrics.json',
      summaryPath: 'lvs_ecc/analysis/qor_summary.json',
    })
    expect(projectManagementWorkspaceSummaryPaths).not.toContain('home/flow.json')
    expect(projectManagementWorkspaceSummaryPaths).not.toContain(
      'home/engineering-snapshot.json',
    )
    expect(projectManagementWorkspaceSummaryPaths).toContain(
      projectManagementStaTimingIssuesPath,
    )
    expect(projectManagementWorkspaceSummaryPaths).toHaveLength(
      1 + projectManagementWorkspaceStepAnalysisSpecs.length * 3,
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

describe('projectManagementWorkspaceReadablePaths', () => {
  it('contains only flow and analysis inputs, not Backend configuration files', () => {
    expect(projectManagementWorkspaceSummaryPaths).not.toContain('config/cts_ecc.json')
    expect(projectManagementWorkspaceReadablePaths).toHaveLength(
      projectManagementWorkspaceSummaryPaths.length + 1,
    )
    expect(projectManagementWorkspaceReadablePaths).toEqual(
      expect.arrayContaining([
        'home/flow.json',
        ...projectManagementWorkspaceSummaryPaths,
      ]),
    )
    expect(new Set(projectManagementWorkspaceReadablePaths).size).toBe(
      projectManagementWorkspaceReadablePaths.length,
    )
  })
})
