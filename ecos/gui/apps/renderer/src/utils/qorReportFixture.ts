import type { QorReportDimension, QorReportV3 } from '@ecos-studio/shared'

/**
 * Test-side builder for the ECC QoR report contract (``home/qor_report.json``).
 * Defaults describe a clean, fully-evidenced workspace; tests override the
 * slices they care about.
 */

const ALL_ECC_STEPS = [
  'Synthesis',
  'Floorplan',
  'place',
  'CTS',
  'legalization',
  'route',
  'filler',
  'drc',
  'lvs',
  'RCX',
  'sta',
  'Harden',
]

export const ALL_SIGNOFF_GATES = [
  'GATE_DRC',
  'GATE_LVS',
  'GATE_SETUP_SLACK',
  'GATE_HOLD_SLACK',
  'GATE_SETUP_NVP',
  'GATE_HOLD_NVP',
  'GATE_HARDEN_ARTIFACTS',
] as const

function passedGate(id: string): QorReportV3['feasibility']['gates'][number] {
  return {
    id,
    stage: gateStage(id),
    state: 'passed',
    predicate: `${id} predicate`,
    blocks_tapeout: true,
    metrics: [],
    availability: null,
    timing_slack: null,
  }
}

function gateStage(id: string): string {
  if (id.includes('DRC')) return 'DRC'
  if (id.includes('LVS')) return 'LVS'
  if (id.includes('HARDEN')) return 'HARDEN'
  return 'STA'
}

export function passedFeasibilityGates(): QorReportV3['feasibility']['gates'] {
  return ALL_SIGNOFF_GATES.map((id) => passedGate(id))
}

function dimension(
  key: QorReportDimension['key'],
  value: number | null,
): QorReportDimension {
  return { key, value, state: value === null ? 'UNKNOWN' : 'PASS', features: [] }
}

export function baseQorRecord(): QorReportV3['qor_record'] {
  return {
    timing: dimension('timing', 90),
    interconnect: dimension('interconnect', 84),
    area: dimension('area', 92),
    power: dimension('power', null),
    robustness: dimension('robustness', 88),
  }
}

export function baseQorReport(): QorReportV3 {
  return {
    schema_version: 3,
    scoring_engine: 'qor-v3',
    design: 'gcd',
    workspace: '/projects/gcd/ws',
    timestamp: '2026-09-09T00:00:00.000Z',
    profile: 'balanced',
    tclk_ns: 20,
    feasibility: { status: 'PASS', gates: passedFeasibilityGates() },
    evidence: { index: 100, state: 'HIGH', integrity: 1, coverage: 1, consistency: 1 },
    qor_record: baseQorRecord(),
    scalar_summary: {
      score: 89,
      status: 'YELLOW',
      profile: 'balanced',
      weights: {
        timing: 0.3,
        interconnect: 0.25,
        area: 0.15,
        power: 0.15,
        robustness: 0.15,
      },
    },
    diagnoses: [],
    inflation: {
      i_place: 1.1,
      i_route: null,
      i_total: null,
      congestion_severity: 0,
      compatibility_status: 'INCOMPATIBLE',
    },
    flow_steps: Object.fromEntries(ALL_ECC_STEPS.map((step) => [step, 'Success'])),
    config_warnings: [],
  }
}

export function buildQorReportText(overrides: Partial<QorReportV3> = {}): string {
  return JSON.stringify({ ...baseQorReport(), ...overrides })
}

export const PASSING_QOR_REPORT_TEXT = buildQorReportText()
