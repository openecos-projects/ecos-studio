import { describe, expect, it } from 'vitest'
import {
  frontendQorForStepState,
  frontendQorGateEvidence,
  parseFrontendStepQorArtifacts,
  parseFrontendStepQorTexts,
  type FrontendQorGate,
} from './frontendQor'

const generation = 'qor-generation-1'
const inputFingerprint = 'a'.repeat(64)

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
  context: {
    comparison: {
      fingerprint: 'same-workload',
      inputs: { input_fingerprint: inputFingerprint },
    },
  },
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
  it.each([
    ['frontend_contracts', 0, 'pass', '0 input contract failures; none allowed'],
    ['no_actionable_errors', 1, 'failed', '1 actionable RTL error; none allowed'],
    ['no_elaboration_errors', 2, 'failed', '2 elaboration errors; none allowed'],
    ['all_modules_resolved', 0, 'pass', '0 unresolved modules; none allowed'],
    ['no_cpu_lint_errors', 3, 'failed', '3 CPU-owned lint errors; none allowed'],
    [
      'all_required_cases_pass',
      0,
      'pass',
      '0 required simulation failures; none allowed',
    ],
    [
      'simulation_cases_present',
      1,
      'pass',
      '1 simulation case produced; at least 1 required',
    ],
    ['difftest_matches_reference', 0, 'pass', '0 Difftest mismatches; none allowed'],
  ] as const)(
    'explains the %s gate without exposing a raw comparison',
    (id, actual, state, evidence) => {
      expect(
        frontendQorGateEvidence({
          id,
          label: id,
          state,
          actual,
          operator: id === 'simulation_cases_present' ? '>' : '==',
          expected: 0,
        }),
      ).toBe(evidence)
    },
  )

  it('explains boolean and unknown gates in plain language', () => {
    expect(
      frontendQorGateEvidence({
        id: 'yosys_precheck',
        label: 'Yosys structural precheck',
        state: 'pass',
        actual: 1,
        operator: '==',
        expected: 1,
      }),
    ).toBe('Yosys structural precheck completed successfully')
    expect(
      frontendQorGateEvidence({
        id: 'top_module_resolved',
        label: 'Top module resolved',
        state: 'failed',
        actual: 0,
        operator: '==',
        expected: 1,
      }),
    ).toBe('Top module could not be resolved')
    expect(
      frontendQorGateEvidence({
        id: 'future_gate',
        label: 'Future gate',
        state: 'failed',
        actual: 7,
        operator: '<=',
        expected: 4,
      } satisfies FrontendQorGate),
    ).toBe('Actual: 7; required: at most 4')
  })

  it('parses structured artifacts used by Frontend Workspace', () => {
    expect(parseFrontendStepQorArtifacts({ metrics, summary, hotspots })).toMatchObject({
      status: 'pass',
      available: true,
      analysisStatus: 'valid',
      comparisonFingerprint: 'same-workload',
      inputFingerprint,
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

  it.each(['truncated', 'g'.repeat(64), ` ${inputFingerprint} `])(
    'does not present an invalid input identity as a complete SHA-256 value',
    (invalidFingerprint) => {
      const invalidSummary = {
        ...summary,
        context: {
          comparison: {
            ...summary.context.comparison,
            inputs: { input_fingerprint: invalidFingerprint },
          },
        },
      }

      expect(
        parseFrontendStepQorArtifacts({ metrics, summary: invalidSummary, hotspots })
          .inputFingerprint,
      ).toBe('')
    },
  )

  it('parses an explainable preparation readiness score', () => {
    const scoreSummary = {
      ...summary,
      score: {
        label: 'Preparation readiness',
        value: 100,
        maximum: 100,
        scoring_version: 1,
        components: [
          {
            id: 'source_resolution',
            label: 'Source resolution',
            earned: 30,
            possible: 30,
            summary: '44 of 44 RTL sources and 0 of 0 include directories resolved.',
          },
          {
            id: 'top_resolution',
            label: 'Top resolution',
            earned: 20,
            possible: 20,
            summary: '1 matching definition found; source is in prepared inputs.',
          },
          {
            id: 'interface_contract',
            label: 'Interface contract',
            earned: 40,
            possible: 40,
            summary: '61 of 61 required ports matched; 0 unexpected.',
          },
          {
            id: 'reproducibility',
            label: 'Reproducibility',
            earned: 10,
            possible: 10,
            summary: 'Input fingerprint recorded; normalized outputs persisted.',
          },
        ],
      },
    }

    const parsed = parseFrontendStepQorArtifacts({
      metrics,
      summary: scoreSummary,
      hotspots,
    })

    expect(parsed.score).toEqual({
      label: 'Preparation readiness',
      value: 100,
      maximum: 100,
      scoringVersion: 1,
      components: expect.arrayContaining([
        expect.objectContaining({ id: 'interface_contract', earned: 40, possible: 40 }),
        expect.objectContaining({
          id: 'reproducibility',
          summary:
            'Input snapshot tracked; normalized input manifest and file list persisted.',
        }),
      ]),
    })

    const invalidIdentitySummary = {
      ...scoreSummary,
      context: {
        comparison: {
          ...scoreSummary.context.comparison,
          inputs: { input_fingerprint: 'invalid' },
        },
      },
    }
    const invalidIdentity = parseFrontendStepQorArtifacts({
      metrics,
      summary: invalidIdentitySummary,
      hotspots,
    })

    expect(invalidIdentity.inputFingerprint).toBe('')
    expect(
      invalidIdentity.score?.components.find(({ id }) => id === 'reproducibility')
        ?.summary,
    ).toBe(
      'Input snapshot not tracked; normalized input manifest and file list persisted.',
    )
  })

  it('ignores a malformed optional score without hiding valid QoR artifacts', () => {
    const malformedSummary = {
      ...summary,
      score: {
        label: 'Preparation readiness',
        value: 120,
        maximum: 100,
        scoring_version: 1,
        components: [],
      },
    }

    expect(
      parseFrontendStepQorArtifacts({ metrics, summary: malformedSummary, hotspots }),
    ).toMatchObject({ available: true, status: 'pass', score: null })
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
      inputFingerprint: '',
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
        inputFingerprint: '',
        score: null,
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
