import { describe, expect, it } from 'vitest'
import { parseQorReport } from './qorReport'

function fullReport() {
  return {
    schema_version: 3,
    scoring_engine: 'qor-v3',
    design: 'gcd',
    workspace: '/projects/gcd/ws',
    timestamp: '2026-09-09T00:00:00.000Z',
    profile: 'balanced',
    tclk_ns: 20,
    feasibility: {
      status: 'PASS',
      gates: [
        {
          id: 'GATE_DRC',
          stage: 'DRC',
          state: 'passed',
          predicate: 'drc_count == 0',
          blocks_tapeout: true,
          metrics: ['drc_count'],
          availability: null,
          timing_slack: null,
        },
      ],
    },
    evidence: { index: 100, state: 'HIGH', integrity: 1, coverage: 1, consistency: 1 },
    qor_record: {
      timing: { key: 'timing', value: 100, state: 'OPPORTUNITY', features: [] },
      interconnect: { key: 'interconnect', value: 75.4, state: 'PASS', features: [] },
      area: { key: 'area', value: 100, state: 'PASS', features: [] },
      power: { key: 'power', value: null, state: 'UNKNOWN', features: [] },
      robustness: { key: 'robustness', value: 94.1, state: 'PASS', features: [] },
    },
    scalar_summary: {
      score: 91.7,
      status: 'GREEN',
      profile: 'balanced',
      weights: { timing: 0.3 },
    },
    diagnoses: [],
    inflation: {
      i_place: 1.213,
      i_route: null,
      i_total: null,
      congestion_severity: 0,
      compatibility_status: 'INCOMPATIBLE',
    },
    flow_steps: { drc: 'Success' },
    config_warnings: [],
  }
}

describe('parseQorReport', () => {
  it('accepts the reference-shaped report', () => {
    const report = parseQorReport(JSON.stringify(fullReport()))
    expect(report?.scalar_summary.score).toBe(91.7)
    expect(report?.qor_record.robustness.value).toBe(94.1)
  })

  it('rejects broken JSON', () => {
    expect(parseQorReport('{')).toBeNull()
  })

  it('rejects foreign schema versions and engines', () => {
    const foreign = { ...fullReport(), schema_version: 2 }
    expect(parseQorReport(JSON.stringify(foreign))).toBeNull()
    const otherEngine = { ...fullReport(), scoring_engine: 'legacy' }
    expect(parseQorReport(JSON.stringify(otherEngine))).toBeNull()
  })

  it('rejects reports missing a Qphys dimension', () => {
    const incomplete = fullReport()
    delete (incomplete.qor_record as Record<string, unknown>).power
    expect(parseQorReport(JSON.stringify(incomplete))).toBeNull()
  })

  it('rejects malformed feasibility blocks', () => {
    const broken = { ...fullReport(), feasibility: { status: 'PASS' } }
    expect(parseQorReport(JSON.stringify(broken))).toBeNull()
  })

  it('rejects malformed nested gates, features, and diagnoses', () => {
    const brokenGate = {
      ...fullReport(),
      feasibility: { status: 'PASS', gates: [{ state: 'failed' }] },
    }
    expect(parseQorReport(JSON.stringify(brokenGate))).toBeNull()
    const brokenFeature = {
      ...fullReport(),
      qor_record: {
        ...fullReport().qor_record,
        timing: { ...fullReport().qor_record.timing, features: [null] },
      },
    }
    expect(parseQorReport(JSON.stringify(brokenFeature))).toBeNull()
    const brokenDiagnosis = {
      ...fullReport(),
      diagnoses: [{ diagnosis_id: 'broken', interventions: [null] }],
    }
    expect(parseQorReport(JSON.stringify(brokenDiagnosis))).toBeNull()
  })

  it('rejects non-numeric scalar scores', () => {
    const broken = { ...fullReport(), scalar_summary: { score: 'high' } }
    expect(parseQorReport(JSON.stringify(broken))).toBeNull()
  })
})
