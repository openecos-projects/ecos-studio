import { describe, expect, it } from 'vitest'
import {
  projectManagementFrontendWorkspaceStepAnalysisSpecs,
  projectManagementFrontendWorkspaceSummaryPaths,
  projectManagementWorkspaceStepAnalysisSpecs,
} from './projectManagementSummary'

describe('project management analysis sources', () => {
  it('lists frontend reports', () => {
    expect(projectManagementFrontendWorkspaceStepAnalysisSpecs).toHaveLength(5)
    expect(projectManagementFrontendWorkspaceSummaryPaths).toHaveLength(21)
    expect(new Set(projectManagementFrontendWorkspaceSummaryPaths).size).toBe(21)
    expect(projectManagementFrontendWorkspaceSummaryPaths).toContain('home/flow.json')
  })

  it('maps backend report phases to ECC step IDs', () => {
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
    })
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find((spec) => spec.step === 'Floor'),
    ).toMatchObject({
      eccStepIds: ['post_floorplan', 'pre_floorplan', 'macro_placement'],
    })
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find((spec) => spec.step === 'Place'),
    ).toMatchObject({
      eccStepIds: ['placement', 'preplace', 'diff_sizing'],
    })
    expect(
      projectManagementWorkspaceStepAnalysisSpecs.find(
        (spec) => spec.step === 'Timing Opt',
      ),
    ).toMatchObject({ eccStepIds: ['timing_optimization'] })
  })
})
