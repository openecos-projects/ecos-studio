import { describe, expect, it } from 'vitest'
import {
  projectManagementFrontendWorkspaceStepAnalysisSpecs,
  projectManagementFrontendWorkspaceSummaryPaths,
  projectManagementStaTimingIssuesPath,
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManagementWorkspaceSummaryPaths,
  projectManagementWorkspaceSummaryPathsFor,
} from './projectManagementSummary'

describe('projectManagementWorkspaceSummaryPaths', () => {
  it('keeps frontend reports separate from the backend allowlist', () => {
    expect(projectManagementWorkspaceSummaryPathsFor('backend')).toBe(
      projectManagementWorkspaceSummaryPaths,
    )
    expect(projectManagementWorkspaceSummaryPathsFor('frontend')).toBe(
      projectManagementFrontendWorkspaceSummaryPaths,
    )
    expect(projectManagementFrontendWorkspaceStepAnalysisSpecs).toHaveLength(5)
    expect(projectManagementFrontendWorkspaceSummaryPaths).toHaveLength(21)
    expect(new Set(projectManagementFrontendWorkspaceSummaryPaths).size).toBe(21)
    expect(projectManagementFrontendWorkspaceSummaryPaths).toContain('home/flow.json')
    expect(projectManagementFrontendWorkspaceSummaryPaths).not.toContain(
      projectManagementStaTimingIssuesPath,
    )
  })

  it('is the unique bounded summary allowlist derived from every analysis step', () => {
    expect(projectManagementWorkspaceStepAnalysisSpecs).toHaveLength(14)
    expect(projectManagementWorkspaceStepAnalysisSpecs.map((spec) => spec.step)).toEqual([
      'Synth',
      'Floor',
      'Place',
      'CTS',
      'Legal',
      'Timing Opt',
      'Route',
      'Filler',
      'LVS',
      'DRC',
      'RCX',
      'STA',
      'Power Analysis',
      'Harden',
    ])
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find((spec) => spec.step === 'LVS'),
    ).toMatchObject({
      eccStepIds: ['lvs'],
      metricsPath: 'lvs_ecc/analysis/qor_metrics.json',
      summaryPath: 'lvs_ecc/analysis/qor_summary.json',
    })
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find((spec) => spec.step === 'Floor'),
    ).toMatchObject({
      eccStepIds: ['postFloorplan', 'preFloorplan', 'macroPlacement'],
      metricsPath: 'postFloorplan_ecc/analysis/qor_metrics.json',
    })
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find((spec) => spec.step === 'Place'),
    ).toMatchObject({
      eccStepIds: ['place', 'preplace', 'diff_sizing'],
      metricsPath: 'place_dreamplace/analysis/qor_metrics.json',
    })
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find(
        (spec) => spec.step === 'Timing Opt',
      ),
    ).toMatchObject({
      metricsPath: 'timing_optimization_sizer/analysis/qor_metrics.json',
    })
    expect(projectManagementWorkspaceSummaryPaths).not.toContain('home/flow.json')
    expect(projectManagementWorkspaceSummaryPaths).not.toContain('config/cts_ecc.json')
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
