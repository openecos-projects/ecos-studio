import { describe, expect, it } from 'vitest'
import {
  frontendQorForStepState,
  parseFrontendStepQorArtifacts,
  parseFrontendStepQorTexts,
} from './frontendQor'

const generation = 'qor-generation-1'

const metrics = {
  schema_version: 3,
  generation,
  metrics: [
    {
      id: 'simulation_pass_rate',
      display_name: 'Simulation Pass Rate',
      value: 1,
      unit: 'ratio',
      category: 'verification',
      direction: 'higher_is_better',
      rating: { gate: true, trend: true },
    },
  ],
}

const summary = {
  schema_version: 4,
  generation,
  analysis_status: 'valid',
  quality_status: 'pass',
  context: { comparison: { fingerprint: 'same-workload' } },
  gates: [
    {
      id: 'all_required_cases_pass',
      title: 'All required cases pass',
      state: 'pass',
      metrics: [{ actual: 1, operator: '==', expected: 1 }],
    },
  ],
}

const hotspots = {
  schema_version: 3,
  generation,
  hotspots: [
    {
      metric_id: 'slow_case',
      display_name: 'Slow case',
      severity: 'warning',
      description: 'Cycle count increased.',
      source: { path: 'report/cases.json' },
    },
  ],
}

describe('frontend QoR parser', () => {
  it('parses structured artifacts used by Frontend Workspace', () => {
    expect(parseFrontendStepQorArtifacts({ metrics, summary, hotspots })).toMatchObject({
      status: 'pass',
      available: true,
      analysisStatus: 'valid',
      comparisonFingerprint: 'same-workload',
      metrics: [{ id: 'simulation_pass_rate', display: '100%' }],
      gates: [{ id: 'all_required_cases_pass', state: 'pass' }],
      hotspots: [{ id: 'slow_case-0', severity: 'warning' }],
    })
  })

  it('uses the same parser for Project Management JSON text artifacts', () => {
    expect(
      parseFrontendStepQorTexts(
        JSON.stringify(metrics),
        JSON.stringify(summary),
        JSON.stringify(hotspots),
      ),
    ).toEqual(parseFrontendStepQorArtifacts({ metrics, summary, hotspots }))
  })

  it('does not report pass when the artifact triplet is incomplete', () => {
    expect(parseFrontendStepQorArtifacts({ summary })).toMatchObject({
      status: 'incomplete',
      available: false,
    })
    expect(parseFrontendStepQorArtifacts(undefined)).toMatchObject({
      status: 'unavailable',
      available: false,
    })
  })

  it('rejects QoR artifacts from mixed generations', () => {
    const staleSummary = { ...summary, generation: 'qor-generation-0' }

    expect(
      parseFrontendStepQorArtifacts({ metrics, summary: staleSummary, hotspots }),
    ).toMatchObject({
      status: 'incomplete',
      analysisStatus: 'incomplete',
      available: false,
      comparisonFingerprint: '',
      metrics: [],
      gates: [],
      hotspots: [],
    })
  })

  it.each(['Unstart', 'Ongoing', 'Pending', 'Invalid'])(
    'hides stale QoR while the live step state is %s',
    (state) => {
      const parsed = parseFrontendStepQorArtifacts({ metrics, summary, hotspots })

      expect(frontendQorForStepState(parsed, state)).toEqual({
        status: 'incomplete',
        analysisStatus: 'incomplete',
        available: false,
        comparisonFingerprint: '',
        metrics: [],
        gates: [],
        hotspots: [],
      })
    },
  )

  it('hides QoR while a step is running or marked stale and preserves terminal results', () => {
    const parsed = parseFrontendStepQorArtifacts({ metrics, summary, hotspots })

    expect(frontendQorForStepState(parsed, 'Success')).toBe(parsed)
    expect(frontendQorForStepState(parsed, 'Incomplete')).toBe(parsed)
    expect(frontendQorForStepState(parsed, 'Success', { running: true })).toMatchObject({
      status: 'incomplete',
      available: false,
    })
    expect(frontendQorForStepState(parsed, 'Success', { stale: true })).toMatchObject({
      status: 'incomplete',
      available: false,
    })
  })
})
