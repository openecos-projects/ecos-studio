import { describe, expect, it } from 'vitest'
import type { ProjectAnalysisStepSnapshot } from '../contracts/backendProjectComparison'
import { stepAnalysisAvailability } from './projectAnalysisAvailability'

function snapshot(
  overrides: Partial<ProjectAnalysisStepSnapshot>,
): ProjectAnalysisStepSnapshot {
  return {
    step: 'STA',
    flowStatus: 'success',
    artifactStatus: 'available',
    summaryArtifactStatus: 'available',
    hotspotArtifactStatus: 'available',
    summaryStatus: 'pass',
    analysisStatus: 'valid',
    blockingIssues: [],
    missingMetrics: [],
    hardGateFailures: [],
    hotspots: [],
    details: [],
    integrityIssues: [],
    timingIssues: [],
    timingCoverage: null,
    metrics: [],
    ...overrides,
  }
}

describe('stepAnalysisAvailability', () => {
  it('ignores a missing optional hotspot index', () => {
    expect(
      stepAnalysisAvailability(
        snapshot({ hotspotArtifactStatus: 'missing', hotspotRequired: false }),
      ),
    ).toBe('available')
  })

  it('requires a hotspot index when the step contract marks it required', () => {
    expect(
      stepAnalysisAvailability(
        snapshot({ hotspotArtifactStatus: 'missing', hotspotRequired: true }),
      ),
    ).toBe('incomplete')
  })

  it('keeps advisory report warnings out of the incomplete state', () => {
    expect(
      stepAnalysisAvailability(
        snapshot({
          step: 'EMIR',
          reportOnly: true,
          analysisRequirement: 'advisory',
          reportItems: [
            {
              id: 'flow.emir.completed',
              title: 'emir flow completed',
              state: 'warning',
              blocked: false,
              summary: 'Review the advisory report.',
              source: 'home/flow.json',
            },
          ],
        }),
      ),
    ).toBe('available')
  })

  it('marks required report warnings incomplete', () => {
    expect(
      stepAnalysisAvailability(
        snapshot({
          step: 'Post-route LEC',
          reportOnly: true,
          analysisRequirement: 'required',
          reportItems: [
            {
              id: 'artifact.postroutelec.result',
              title: 'LEC result',
              state: 'warning',
              blocked: false,
              summary: 'Evidence needs review.',
              source: 'postRouteLec_kepler_formal/checklist.json',
            },
          ],
        }),
      ),
    ).toBe('incomplete')
  })

  it('keeps incomplete metric coverage distinct from unloaded content', () => {
    expect(stepAnalysisAvailability(snapshot({ analysisStatus: 'incomplete' }))).toBe(
      'incomplete',
    )
    expect(stepAnalysisAvailability(snapshot({ analysisSummaryLoaded: false }))).toBe(
      'pending',
    )
  })
})
