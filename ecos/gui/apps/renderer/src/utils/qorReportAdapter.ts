import {
  parseQorReport,
  type QorReportDiagnosis,
  type QorReportFeasibilityGate,
  type QorReportPowerObservation,
  type QorReportV3,
} from '@ecos-studio/shared'
import type { FlowStep, ProjectStepStatus } from './projectManagement'
import type {
  ProjectQorBlockingIssue,
  ProjectQorDiagnosisView,
  ProjectQorEvidenceView,
  ProjectQorSignoffGroup,
  ProjectQorSignoffReadiness,
  QphysKey,
  QorGateStatus,
  QorScalarStatus,
} from './projectQorTrend'

/**
 * Bridge between the ECC-written ``home/qor_report.json`` and the GUI
 * workspace model. ECC is the single scoring authority: the adapter only
 * translates, and a missing, malformed, or stale report means "not
 * rated" — never a locally recomputed score.
 */

/** GUI FlowStep label -> ECC canonical step name (the report snapshot's keys). */
const FLOW_STEP_TO_ECC: Record<FlowStep, string> = {
  Synth: 'Synthesis',
  Floor: 'Floorplan',
  Place: 'place',
  CTS: 'CTS',
  Legal: 'legalization',
  Route: 'route',
  DRC: 'drc',
  LVS: 'lvs',
  Filler: 'filler',
  RCX: 'RCX',
  STA: 'sta',
  Harden: 'Harden',
}

const ECC_TO_FLOW_STEP = new Map(
  Object.entries(FLOW_STEP_TO_ECC).map(([label, eccStep]) => [
    eccStep,
    label as FlowStep,
  ]),
)

const STAGE_TO_FLOW_STEP: Record<string, FlowStep> = {
  SYNTHESIS: 'Synth',
  FLOORPLAN: 'Floor',
  PLACEMENT: 'Place',
  CTS: 'CTS',
  ROUTE: 'Route',
  DRC: 'DRC',
  LVS: 'LVS',
  RCX: 'RCX',
  STA: 'STA',
  HARDEN: 'Harden',
}

function stageToFlowStep(stage: string): FlowStep {
  return STAGE_TO_FLOW_STEP[stage.toUpperCase()] ?? 'STA'
}

function gateStatusFromReport(report: QorReportV3): QorGateStatus {
  switch (report.feasibility.status) {
    case 'PASS':
      return 'pass'
    case 'PHYSICAL_FAIL':
      return 'blocked'
    case 'NOT_VERIFIED':
      return 'incomplete'
    default:
      return 'unavailable'
  }
}

function gateGroupStatus(gate: QorReportFeasibilityGate): QorGateStatus {
  if (gate.state === 'passed') return 'pass'
  if (gate.state === 'failed') return 'blocked'
  return gate.availability === 'corrupt' ? 'unavailable' : 'incomplete'
}

function isCompletedStepStatus(status: ProjectStepStatus | undefined): boolean {
  return status === 'success' || status === 'reused'
}

/**
 * The report embeds the flow-ledger snapshot it was built from. A report
 * is stale when the ledger moved on after it was written: a step
 * completed later, or a reported step that no longer holds its success
 * (invalidation). Stale means unrated — better a missing score than a
 * wrong one.
 */
export function isQorReportStale(
  report: QorReportV3,
  stepStatuses: Partial<Record<FlowStep, ProjectStepStatus>>,
): boolean {
  for (const [label, status] of Object.entries(stepStatuses)) {
    const eccStep = FLOW_STEP_TO_ECC[label as FlowStep]
    if (!eccStep) continue
    const reported = report.flow_steps[eccStep]
    if (isCompletedStepStatus(status as ProjectStepStatus)) {
      if (reported !== 'Success') return true
    } else if (status === 'failed' && reported === 'Success') {
      return true
    }
  }
  for (const [eccStep, reported] of Object.entries(report.flow_steps)) {
    const label = ECC_TO_FLOW_STEP.get(eccStep)
    if (!label || reported !== 'Success') continue
    const status = stepStatuses[label]
    if (status !== undefined && !isCompletedStepStatus(status)) return true
  }
  return false
}

export interface AdaptedQorScoring {
  overallScore: number | null
  scalarStatus: QorScalarStatus
  gateStatus: QorGateStatus
  signoffReadiness: ProjectQorSignoffReadiness
  blockingIssues: ProjectQorBlockingIssue[]
  dimensionScores: Partial<Record<QphysKey, number>>
  qphys: QphysScore[]
  diagnoses: ProjectQorDiagnosisView[]
  evidence: ProjectQorEvidenceView | null
  power: QorReportPowerObservation | null
  profile: string | null
  scoringEngine: 'qor-v3' | null
}

export interface QphysScore {
  key: QphysKey
  value: number | null
  state: string
  features: {
    featureId: string
    value: number | null
    state: string
    interpretation: string
  }[]
}

/** The unrated model every workspace without a usable report receives. */
export function emptyAdaptedQor(): AdaptedQorScoring {
  return {
    overallScore: null,
    scalarStatus: 'NOT_RATED',
    gateStatus: 'unavailable',
    signoffReadiness: {
      status: 'unavailable',
      scoreEligible: false,
      reasonCodes: [],
      groups: [],
    },
    blockingIssues: [],
    dimensionScores: {},
    qphys: [],
    diagnoses: [],
    evidence: null,
    power: null,
    profile: null,
    scoringEngine: null,
  }
}

export function adaptQorReport(report: QorReportV3): AdaptedQorScoring {
  const feasibility = report.feasibility
  const gateStatus = gateStatusFromReport(report)
  const groups: ProjectQorSignoffGroup[] = feasibility.gates.map((gate) => ({
    step: stageToFlowStep(gate.stage),
    id: gate.id,
    status: gateGroupStatus(gate),
    gate: true,
  }))
  const reasonCodes = feasibility.gates
    .filter((gate) => gate.state !== 'passed')
    .map((gate) => gate.id)
  const signoffReadiness: ProjectQorSignoffReadiness = {
    status: gateStatus,
    scoreEligible: feasibility.status === 'PASS',
    reasonCodes,
    groups,
  }

  const blockingIssues: ProjectQorBlockingIssue[] = feasibility.gates
    .filter((gate) => gate.state === 'failed')
    .map((gate) => ({
      step: stageToFlowStep(gate.stage),
      metric: gate.metrics[0] ?? gate.id,
      displayName: gate.id,
      value: gate.timing_slack?.ws_ns ?? null,
      reason: `${gate.id} failed: ${gate.predicate}`,
      evidence: {
        sourceFile: 'home/qor_report.json',
        sourceSelector: `/feasibility/gates[id=${gate.id}]`,
        expectedOperator: null,
        expectedValue: null,
        diagnosis: gate.predicate,
        availability: gate.availability,
      },
    }))

  const dimensionScores = Object.fromEntries(
    Object.entries(report.qor_record)
      .filter(([, dimension]) => dimension.value !== null)
      .map(([key, dimension]) => [key, dimension.value]),
  ) as Partial<Record<QphysKey, number>>

  const qphys: QphysScore[] = Object.values(report.qor_record).map((dimension) => ({
    key: dimension.key,
    value: dimension.value,
    state: dimension.state,
    features: dimension.features.map((feature) => ({
      featureId: feature.feature_id,
      value: feature.value,
      state: feature.state,
      interpretation: feature.interpretation ?? '',
    })),
  }))

  const diagnoses: ProjectQorDiagnosisView[] = [...report.diagnoses]
    .sort(
      (left, right) =>
        right.severity - left.severity ||
        left.diagnosis_id.localeCompare(right.diagnosis_id),
    )
    .map(adaptDiagnosis)

  return {
    overallScore: report.scalar_summary.score,
    scalarStatus: report.scalar_summary.status,
    gateStatus,
    signoffReadiness,
    blockingIssues,
    dimensionScores,
    qphys,
    diagnoses,
    evidence: {
      index: report.evidence.index,
      state: report.evidence.state,
      integrity: report.evidence.integrity,
      coverage: report.evidence.coverage,
      consistency: report.evidence.consistency,
    },
    power: report.power ?? null,
    profile: report.scalar_summary.profile,
    scoringEngine: 'qor-v3',
  }
}

function adaptDiagnosis(diagnosis: QorReportDiagnosis): ProjectQorDiagnosisView {
  return {
    diagnosisId: diagnosis.diagnosis_id,
    state: diagnosis.state,
    severity: diagnosis.severity,
    confidence: diagnosis.diagnosis_confidence,
    interpretation: diagnosis.interpretation,
    affectedDimensions: diagnosis.affected_dimensions,
    interventions: diagnosis.interventions.map((intervention) => ({
      hypothesis: intervention.hypothesis,
      tier: intervention.tier,
      confidence: intervention.confidence,
      parameterKnob: intervention.parameter_knob,
      validationProcedure: intervention.validation_procedure,
    })),
  }
}

export { parseQorReport }
