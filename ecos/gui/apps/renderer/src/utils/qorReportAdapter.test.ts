import { describe, expect, it } from 'vitest'
import { parseQorReport } from '@ecos-studio/shared'
import { adaptQorReport, emptyAdaptedQor, isQorReportStale } from './qorReportAdapter'
import { baseQorReport, buildQorReportText } from './qorReportFixture'
import type { ProjectStepStatus } from './projectManagement'

function successStates(): Partial<Record<string, ProjectStepStatus>> {
  return {
    Synth: 'success',
    Floor: 'success',
    Place: 'success',
    CTS: 'success',
    Legal: 'success',
    Route: 'success',
    DRC: 'success',
    LVS: 'success',
    Filler: 'success',
    RCX: 'success',
    STA: 'success',
    Harden: 'success',
  }
}

describe('parseQorReport', () => {
  it('parses a well-formed report', () => {
    const report = parseQorReport(buildQorReportText())
    expect(report).not.toBeNull()
    expect(report?.schema_version).toBe(3)
    expect(report?.scoring_engine).toBe('qor-v3')
  })

  it('returns null for missing, broken, or foreign payloads', () => {
    expect(parseQorReport(null)).toBeNull()
    expect(parseQorReport('')).toBeNull()
    expect(parseQorReport('{not json')).toBeNull()
    expect(parseQorReport(JSON.stringify({ schema_version: 2 }))).toBeNull()
    expect(
      parseQorReport(JSON.stringify({ ...baseQorReport(), scoring_engine: 'other' })),
    ).toBeNull()
    expect(
      parseQorReport(JSON.stringify({ ...baseQorReport(), qor_record: { timing: {} } })),
    ).toBeNull()
  })
})

describe('isQorReportStale', () => {
  it('accepts a report whose ledger snapshot matches the live states', () => {
    const report = parseQorReport(buildQorReportText())!
    expect(isQorReportStale(report, successStates() as never)).toBe(false)
  })

  it('flags a step completed after the report was written', () => {
    const report = parseQorReport(
      buildQorReportText({
        // The report predates Harden's completion: its snapshot lacks it.
        flow_steps: Object.fromEntries(
          Object.entries(baseQorReport().flow_steps).filter(
            ([step]) => step !== 'Harden',
          ),
        ),
      }),
    )!
    expect(isQorReportStale(report, successStates() as never)).toBe(true)
  })

  it('flags a reported step that no longer holds its success', () => {
    const report = parseQorReport(buildQorReportText())!
    const statuses = {
      ...successStates(),
      Harden: 'unstart',
    } as Partial<Record<string, ProjectStepStatus>>
    expect(isQorReportStale(report, statuses as never)).toBe(true)
  })

  it('flags a step that failed after the report called it a success', () => {
    const report = parseQorReport(buildQorReportText())!
    const statuses = { ...successStates(), DRC: 'failed' } as Partial<
      Record<string, ProjectStepStatus>
    >
    expect(isQorReportStale(report, statuses as never)).toBe(true)
  })
})

describe('adaptQorReport', () => {
  it('maps the scalar projection, gate status, and evidence onto the GUI model', () => {
    const report = parseQorReport(buildQorReportText())!
    const adapted = adaptQorReport(report)

    expect(adapted).toMatchObject({
      overallScore: 89,
      scalarStatus: 'YELLOW',
      gateStatus: 'pass',
      scoringEngine: 'qor-v3',
      profile: 'balanced',
      evidence: { state: 'HIGH', coverage: 1 },
    })
    expect(adapted.signoffReadiness).toMatchObject({
      status: 'pass',
      scoreEligible: true,
    })
    expect(adapted.signoffReadiness.groups).toHaveLength(7)
    expect(adapted.blockingIssues).toEqual([])
    // Null coordinates drop out of the score map; power has no budget.
    expect(adapted.dimensionScores).toEqual({
      timing: 90,
      interconnect: 84,
      area: 92,
      robustness: 88,
    })
  })

  it('turns failed feasibility gates into blocking issues on the right step', () => {
    const report = parseQorReport(
      buildQorReportText({
        feasibility: {
          status: 'PHYSICAL_FAIL',
          gates: passedFeasibilityGatesWithFailedLvs(),
        },
        scalar_summary: { score: 0, status: 'FAIL', profile: 'balanced', weights: {} },
      }),
    )!
    const adapted = adaptQorReport(report)

    expect(adapted.gateStatus).toBe('blocked')
    expect(adapted.blockingIssues).toEqual([
      expect.objectContaining({ step: 'LVS', displayName: 'GATE_LVS' }),
    ])
    expect(adapted.signoffReadiness.scoreEligible).toBe(false)
  })

  it('orders diagnoses by descending severity', () => {
    const report = parseQorReport(
      buildQorReportText({
        diagnoses: [
          {
            diagnosis_id: 'diag.a',
            state: 'WATCH',
            severity: 0.25,
            diagnosis_confidence: 'HIGH',
            trigger_features: [],
            supporting_metrics: [],
            interpretation: 'minor',
            affected_dimensions: [],
            interventions: [],
            intervention_confidence: 'LOW',
            validation_required: null,
          },
          {
            diagnosis_id: 'diag.b',
            state: 'FAIL',
            severity: 0.9,
            diagnosis_confidence: 'HIGH',
            trigger_features: [],
            supporting_metrics: [],
            interpretation: 'severe',
            affected_dimensions: [],
            interventions: [
              {
                hypothesis: 'try a thing',
                tier: 'TIER_1_FEASIBILITY',
                confidence: 'MEDIUM',
                parameter_knob: null,
                validation_procedure: 'rerun',
              },
            ],
            intervention_confidence: 'MEDIUM',
            validation_required: 'rerun',
          },
        ],
      }),
    )!
    const adapted = adaptQorReport(report)

    expect(adapted.diagnoses.map((diagnosis) => diagnosis.diagnosisId)).toEqual([
      'diag.b',
      'diag.a',
    ])
    expect(adapted.diagnoses[0]?.interventions[0]).toMatchObject({
      tier: 'TIER_1_FEASIBILITY',
      validationProcedure: 'rerun',
    })
  })
})

describe('emptyAdaptedQor', () => {
  it('is the unrated model, never a fabricated score', () => {
    expect(emptyAdaptedQor()).toMatchObject({
      overallScore: null,
      scalarStatus: 'NOT_RATED',
      gateStatus: 'unavailable',
      scoringEngine: null,
      blockingIssues: [],
      qphys: [],
    })
  })
})

function passedFeasibilityGatesWithFailedLvs() {
  const gates = baseQorReport().feasibility.gates.map((gate) =>
    gate.id === 'GATE_LVS' ? { ...gate, state: 'failed' as const } : gate,
  )
  return gates
}
