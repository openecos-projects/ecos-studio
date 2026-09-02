import { describe, expect, it } from 'vitest'
import {
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
        flow: { status: 'ready' },
        qor: { status: 'ready' },
        signoff: { status: 'ready' },
      })
      expect(snapshot.flow).toEqual({
        steps: projectManifestFlowSteps.map((name) => ({ name, state: 'Success' })),
      })
      expect(snapshot.metrics).toHaveLength(181)
      expect(snapshot.analysis.steps).toHaveLength(13)
      expect(snapshot.analysis.steps.map((step) => step.stepId)).toEqual(
        projectManifestFlowSteps,
      )
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
      expect(snapshot.artifacts).toHaveLength(40)
      expect(snapshot.signoffAssessment.status).toBe('ready')
      expect(snapshot.qorAssessment).toMatchObject({
        score: { gate: 'pass', threshold: 60, value: expect.any(Number) },
      })
    }
  })
})
