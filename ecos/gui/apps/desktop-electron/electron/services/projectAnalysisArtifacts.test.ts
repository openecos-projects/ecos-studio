import { describe, expect, it } from 'vitest'
import type { EccEngineeringAnalysisArtifactRef } from '@ecos-studio/shared'
import {
  projectAnalysisArtifactStatuses,
  projectStepSummaryArtifactRefs,
} from './projectAnalysisArtifacts'

function artifact(
  stepId: string,
  kind: string,
  reference: string,
  availability: 'available' | 'missing' = 'available',
  required?: boolean,
): EccEngineeringAnalysisArtifactRef {
  return {
    artifactId: `${stepId}-${kind}`,
    availability,
    kind,
    name: reference.split('/').at(-1) ?? reference,
    reference,
    ...(required === undefined ? {} : { required }),
    stepId,
  }
}

describe('projectAnalysisArtifacts', () => {
  it('resolves grouped Floor artifacts per kind instead of requiring one producer', () => {
    const artifacts = [
      artifact(
        'postFloorplan',
        'qor_metrics',
        'postFloorplan_ecc/analysis/qor_metrics.json',
      ),
      artifact(
        'preFloorplan',
        'qor_summary',
        'preFloorplan_ecc/analysis/qor_summary.json',
      ),
    ]

    expect(projectAnalysisArtifactStatuses(artifacts)?.Floor).toEqual({
      artifactStatus: 'available',
      hotspotArtifactStatus: 'missing',
      hotspotRequired: false,
      summaryArtifactStatus: 'available',
    })
    expect(projectStepSummaryArtifactRefs(artifacts)).toContainEqual({
      reference: 'preFloorplan_ecc/analysis/qor_summary.json',
      step: 'Floor',
    })
  })

  it('keeps an unavailable preferred artifact from masking a later available producer', () => {
    const artifacts = [
      artifact(
        'place',
        'qor_summary',
        'place_dreamplace/analysis/qor_summary.json',
        'missing',
      ),
      artifact('preplace', 'qor_summary', 'preplace_sizer/analysis/qor_summary.json'),
    ]

    expect(projectAnalysisArtifactStatuses(artifacts)?.Place?.summaryArtifactStatus).toBe(
      'available',
    )
  })

  it('uses the ECC artifact requirement instead of the local step policy', () => {
    const artifacts = [
      artifact('Synthesis', 'qor_metrics', 'Synthesis_yosys/analysis/qor_metrics.json'),
      artifact('Synthesis', 'qor_summary', 'Synthesis_yosys/analysis/qor_summary.json'),
      artifact(
        'Synthesis',
        'qor_hotspots',
        'Synthesis_yosys/analysis/qor_hotspots.json',
        'missing',
        true,
      ),
    ]

    expect(projectAnalysisArtifactStatuses(artifacts)?.Synth?.hotspotRequired).toBe(true)
  })
})
