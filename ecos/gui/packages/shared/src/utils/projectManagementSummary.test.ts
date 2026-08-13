import { describe, expect, it } from 'vitest'
import {
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManagementWorkspaceSummaryPaths,
} from './projectManagementSummary'

describe('projectManagementWorkspaceSummaryPaths', () => {
  it('is the unique bounded summary allowlist derived from every analysis step', () => {
    expect(projectManagementWorkspaceStepAnalysisSpecs).toHaveLength(12)
    expect(projectManagementWorkspaceSummaryPaths).toContain('home/flow.json')
    expect(projectManagementWorkspaceSummaryPaths).toContain(
      projectManagementStaTimingIssuesPath,
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
