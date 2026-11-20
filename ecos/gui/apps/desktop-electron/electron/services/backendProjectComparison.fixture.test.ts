import { describe, expect, it } from 'vitest'
import {
  projectManagementWorkspaceStepAnalysisSpecs,
  projectManifestFlowSteps,
  validateEngineeringSnapshot,
} from '@ecos-studio/shared'
import { representativeProjectComparisonFixture } from './backendProjectComparison.fixture'

describe('representativeProjectComparisonFixture', () => {
  it('contains every committed Dashboard and Compare fact in Engineering Snapshots', () => {
    const fixture = representativeProjectComparisonFixture()

    for (const snapshot of Object.values(fixture.engineeringSnapshots)) {
      const validated = validateEngineeringSnapshot(snapshot)
      expect(validated.ok && validated.sections).toMatchObject({
        artifacts: { status: 'ready' },
        checklist: { status: 'ready' },
        flow: { status: 'ready' },
        hotspotPreview: { status: 'ready' },
        metrics: { status: 'ready' },
        qorSnapshotExtension: { status: 'ready' },
        signoff: { status: 'ready' },
        timingPreview: { status: 'ready' },
      })
      expect(snapshot.flow).toEqual({
        steps: projectManifestFlowSteps.map((name) => ({ name, state: 'Success' })),
      })
      expect(snapshot.metrics).toHaveLength(251)
      for (const spec of projectManagementWorkspaceStepAnalysisSpecs) {
        for (const kind of ['qor_metrics', 'qor_summary', 'qor_hotspots']) {
          expect(snapshot.artifacts).toContainEqual(
            expect.objectContaining({
              availability: 'available',
              kind,
              stepId: spec.eccStepIds[0],
              reference: expect.stringContaining(`/analysis/${kind}.json`),
            }),
          )
        }
      }
      expect(snapshot.metrics[0]).toMatchObject({
        analysis_group: expect.any(String),
        category: expect.any(String),
        confidence: expect.stringMatching(/^(high|medium|low)$/),
        direction: expect.any(String),
        project_role: expect.any(String),
        rating: { gate: expect.any(Boolean), score: expect.any(Boolean) },
        scope: expect.any(String),
        source: { kind: 'feature', path: expect.any(String) },
        step_role: expect.any(String),
      })
      expect(snapshot.artifacts).toHaveLength(43)
      expect(snapshot.signoffAssessment.status).toBe('ready')
      expect(snapshot.qorSnapshotExtension).toMatchObject({
        scoringEngine: 'qor-v3',
        score: expect.any(Number),
        scalarStatus: expect.stringMatching(/^(GREEN|YELLOW|ORANGE|RED)$/),
      })
    }
  })
})
