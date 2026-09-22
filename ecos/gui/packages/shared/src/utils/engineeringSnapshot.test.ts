import { describe, expect, it } from 'vitest'
import type { EccQorSnapshotExtension } from '../contracts/eccRuntime.ts'
import {
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  parseEngineeringSnapshotJson,
  validateEngineeringSnapshot,
} from './engineeringSnapshot'

const metric = {
  id: 'sta_setup_wns',
  stepId: 'sta',
  display_name: 'STA Setup WNS',
  value: -0.05,
  unit: 'ns',
  category: 'timing',
  direction: 'higher_is_better',
  scope: 'workspace',
  corner: 'typical',
  corner_context: {
    configured_role: 'setup',
    process_corner: 'tt',
    voltage_v: 1.8,
    temperature_c: 25,
    rc_corner: 'typical',
    label: 'TT 1.8V 25C',
  },
  analysis_group: 'sta',
  rating: { gate: true, score: true, trend: true },
  project_role: 'final',
  step_role: 'primary',
  confidence: 'high',
  source: { kind: 'feature', path: 'feature/STA.step.json', selector: '/wns' },
  extension_field: 'preserved',
}

function qorSnapshotExtension(): EccQorSnapshotExtension {
  return {
    schemaVersion: 1,
    scoringEngine: 'qor-v3',
    status: 'available',
    score: 84,
    scalarStatus: 'GREEN',
    profile: 'balanced',
    qphys: {
      timing: { value: 84, state: 'PASS', featureIds: ['timing.setup'] },
    },
    feasibility: {
      status: 'PASS',
      gates: [
        {
          id: 'sta',
          stage: 'STA',
          state: 'passed',
          blocksTapeout: true,
          metrics: ['sta_setup_wns'],
          availability: null,
        },
      ],
    },
    evidence: {
      index: 80,
      state: 'HIGH',
      integrity: 1,
      coverage: 0.9,
      consistency: 1,
    },
    diagnoses: [
      {
        diagnosisId: 'timing-watch',
        state: 'WATCH',
        severity: 0.4,
        confidence: 'HIGH',
        triggerFeatures: ['timing.setup'],
        affectedDimensions: ['timing'],
        interventions: [
          {
            hypothesis: 'Review clock uncertainty',
            tier: 'TIER_1_FEASIBILITY',
            confidence: 'HIGH',
            parameterKnob: 'timing.uncertainty',
            validationProcedure: 'rerun STA',
          },
        ],
        interventionConfidence: 'HIGH',
        validationRequired: null,
      },
    ],
    inflation: {
      iPlace: 1.1,
      iRoute: 1.2,
      iTotal: 1.32,
      congestionSeverity: 0.1,
      compatibilityStatus: 'EXACT_COMPATIBLE',
    },
    power: {
      totalUw: 10,
      budgetUw: 20,
      sourceKind: 'signoff',
      corner: 'tt',
    },
    artifactIds: ['artifact-metrics'],
  }
}

function snapshot() {
  const artifact = {
    artifactId: 'artifact-metrics',
    availability: 'available',
    integrity: 'verified',
    kind: 'qor_metrics',
    name: 'qor_metrics.json',
    reference: 'sta_ecc/analysis/qor_metrics.json',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    stepId: 'sta',
  }
  return {
    schemaVersion: 5,
    workspaceId: 'engineering-workspace',
    workspaceRevision: 14,
    cause: 'flow_step.success',
    flow: { steps: [{ name: 'sta', tool: 'ecc', state: 'Success' }] },
    parameters: {},
    checklist: {},
    metrics: [metric],
    // @ts-ignore legacy payload is rejected by schema 5
    qorSnapshotExtension: qorSnapshotExtension(),
    signoffAssessment: { status: 'ready', groups: [], risks: [] },
    analysis: {
      steps: [
        {
          stepId: 'sta',
          toolId: 'ecc',
          order: 0,
          flowState: 'Success',
          metricCount: 1,
          summaryStatus: 'pass',
          metrics: {
            artifactId: artifact.artifactId,
            status: 'available',
            data: { schema_version: 3, metrics: [metric] },
          },
          summary: {
            artifactId: 'artifact-summary',
            status: 'available',
            data: {
              schema_version: 4,
              analysis_status: 'complete',
              quality_status: 'pass',
              gates: [],
              missing_metrics: [],
            },
          },
          hotspots: {
            artifactId: 'artifact-hotspots',
            status: 'available',
            data: { schema_version: 3, hotspots: [] },
          },
          timingIssues: {
            artifactId: 'artifact-timing',
            status: 'available',
            data: {
              schema_version: 1,
              near_fail_slack_ns: 0.05,
              missing_corners: [],
              issues: [],
              artifact_paths: [],
            },
          },
          subflow: { status: 'missing', steps: [] as Array<Record<string, unknown>> },
        },
      ],
    },
    artifacts: [
      artifact,
      {
        ...artifact,
        artifactId: 'artifact-summary',
        kind: 'qor_summary',
        name: 'qor_summary.json',
        reference: 'sta_ecc/analysis/qor_summary.json',
      },
      {
        ...artifact,
        artifactId: 'artifact-hotspots',
        kind: 'qor_hotspots',
        name: 'qor_hotspots.json',
        reference: 'sta_ecc/analysis/qor_hotspots.json',
      },
      {
        ...artifact,
        artifactId: 'artifact-timing',
        kind: 'sta_timing_issues',
        name: 'sta_timing_issues.json',
        reference: 'sta_ecc/analysis/sta_timing_issues.json',
      },
    ],
  }
}

function snapshotWithInvalidExtension(
  mutate: (extension: EccQorSnapshotExtension) => void,
) {
  const current = snapshot()
  current.schemaVersion = 5
  const extension = qorSnapshotExtension()
  mutate(extension)
  current.qorSnapshotExtension = extension
  return current
}

function invalidQorExtensionResult(current: ReturnType<typeof snapshot>) {
  return validateEngineeringSnapshot(current)
}

describe('Engineering Snapshot validation', () => {
  it('exposes a valid QoR Snapshot extension independently from step metrics', () => {
    const current = snapshot()
    current.qorSnapshotExtension = qorSnapshotExtension()

    const valid = validateEngineeringSnapshot(current)

    expect(valid.ok).toBe(true)
    if (!valid.ok) return
    expect(valid.sections.qorSnapshotExtension).toMatchObject({
      status: 'ready',
      data: { scoringEngine: 'qor-v3', qphys: { timing: { value: 84 } } },
    })

    const invalid = snapshot()
    invalid.qorSnapshotExtension = {
      ...qorSnapshotExtension(),
      qphys: [] as never,
    }
    const partial = validateEngineeringSnapshot(invalid)
    expect(partial).toEqual({
      ok: false,
      issue: { code: 'ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID' },
    })
  })

  it('accepts the extension on the schema 5 production Snapshot', () => {
    const current = snapshot()
    current.schemaVersion = 5
    current.qorSnapshotExtension = qorSnapshotExtension()

    const valid = validateEngineeringSnapshot(current)

    expect(valid.ok && valid.sections.qorSnapshotExtension).toMatchObject({
      status: 'ready',
      data: { scoringEngine: 'qor-v3' },
    })
  })

  it('rejects out-of-range and extra QoR extension fields', () => {
    const outOfRange = snapshot()
    outOfRange.schemaVersion = 5
    outOfRange.qorSnapshotExtension = {
      ...qorSnapshotExtension(),
      qphys: {
        timing: { value: 101, state: 'PASS', featureIds: [] },
      },
    }
    expect(validateEngineeringSnapshot(outOfRange)).toEqual({
      ok: false,
      issue: { code: 'ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID' },
    })

    const extraField = snapshot()
    extraField.schemaVersion = 5
    extraField.qorSnapshotExtension = {
      ...qorSnapshotExtension(),
      evidence: { ...qorSnapshotExtension().evidence, extra: true } as never,
    }
    expect(validateEngineeringSnapshot(extraField)).toEqual({
      ok: false,
      issue: { code: 'ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID' },
    })
  })

  it.each([
    [
      'missing top-level field',
      (extension: EccQorSnapshotExtension) => {
        delete (extension as unknown as Record<string, unknown>).score
      },
    ],
    [
      'extra top-level field',
      (extension: EccQorSnapshotExtension) => {
        ;(extension as unknown as Record<string, unknown>).unexpected = true
      },
    ],
    [
      'invalid profile',
      (extension: EccQorSnapshotExtension) => {
        extension.profile = 'legacy' as never
      },
    ],
    [
      'invalid scalar status',
      (extension: EccQorSnapshotExtension) => {
        extension.scalarStatus = 'UNKNOWN' as never
      },
    ],
    [
      'invalid extension status',
      (extension: EccQorSnapshotExtension) => {
        extension.status = 'partial' as never
      },
    ],
    [
      'invalid intervention tier',
      (extension: EccQorSnapshotExtension) => {
        extension.diagnoses[0]!.interventions[0]!.tier = 'TIER_UNKNOWN' as never
      },
    ],
    [
      'null diagnosis severity',
      (extension: EccQorSnapshotExtension) => {
        extension.diagnoses[0]!.severity = null as never
      },
    ],
    [
      'out-of-range diagnosis severity',
      (extension: EccQorSnapshotExtension) => {
        extension.diagnoses[0]!.severity = 1.1
      },
    ],
    [
      'out-of-range score',
      (extension: EccQorSnapshotExtension) => {
        extension.score = 101
      },
    ],
    [
      'out-of-range evidence',
      (extension: EccQorSnapshotExtension) => {
        extension.evidence.index = 101
      },
    ],
    [
      'negative power',
      (extension: EccQorSnapshotExtension) => {
        extension.power.totalUw = -1
      },
    ],
    [
      'unknown qphys dimension',
      (extension: EccQorSnapshotExtension) => {
        ;(extension.qphys as Record<string, unknown>).unknown = {
          value: 1,
          state: 'PASS',
          featureIds: [],
        }
      },
    ],
    [
      'empty text',
      (extension: EccQorSnapshotExtension) => {
        extension.diagnoses[0]!.diagnosisId = ''
      },
    ],
    [
      'overlong text',
      (extension: EccQorSnapshotExtension) => {
        extension.diagnoses[0]!.diagnosisId = 'x'.repeat(513)
      },
    ],
    [
      'overlong array',
      (extension: EccQorSnapshotExtension) => {
        extension.artifactIds = Array.from(
          { length: 513 },
          (_, index) => `artifact-${index}`,
        )
      },
    ],
    [
      'unavailable without reason',
      (extension: EccQorSnapshotExtension) => {
        extension.status = 'unavailable'
      },
    ],
    [
      'unavailable with empty reason',
      (extension: EccQorSnapshotExtension) => {
        extension.status = 'unavailable'
        extension.reason = ''
      },
    ],
    [
      'available with reason',
      (extension: EccQorSnapshotExtension) => {
        extension.reason = 'not allowed while available'
      },
    ],
    [
      'invalid compatibility status',
      (extension: EccQorSnapshotExtension) => {
        extension.inflation.compatibilityStatus = '' as never
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    expect(invalidQorExtensionResult(snapshotWithInvalidExtension(mutate))).toEqual({
      ok: false,
      issue: { code: 'ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID' },
    })
  })

  it('preserves complete metric metadata and validates sections independently', () => {
    const valid = validateEngineeringSnapshot(snapshot())
    expect(valid.ok).toBe(true)
    if (!valid.ok) return
    expect(valid.sections.qor.status).toBe('ready')
    expect(
      valid.sections.qor.status === 'ready' && valid.sections.qor.data.metrics[0],
    ).toEqual(metric)

    const invalidFlow = snapshot()
    invalidFlow.flow = { steps: [{ name: 'sta', tool: 'ecc' }] } as never
    const partial = validateEngineeringSnapshot(invalidFlow)
    expect(partial.ok).toBe(true)
    if (!partial.ok) return
    expect(partial.sections).toMatchObject({
      flow: { status: 'unavailable', issues: [{ code: 'ENGINEERING_FLOW_INVALID' }] },
      qor: { status: 'ready', issues: [] },
      signoff: { status: 'ready', issues: [] },
      artifacts: { status: 'ready', issues: [] },
    })

    const unsafeArtifact = snapshot()
    unsafeArtifact.artifacts[0]!.reference = '../outside.json'
    const unsafe = validateEngineeringSnapshot(unsafeArtifact)
    expect(unsafe.ok && unsafe.sections).toMatchObject({
      artifacts: {
        status: 'unavailable',
        issues: [{ code: 'ENGINEERING_ARTIFACT_INVALID' }],
      },
      flow: { status: 'ready' },
      qor: { status: 'ready' },
      signoff: { status: 'ready' },
    })
  })

  it('accepts oversized analysis references without embedded detail data', () => {
    const current = snapshot()
    current.analysis.steps[0]!.timingIssues = {
      artifactId: 'artifact-timing',
      status: 'oversized',
      reasonCode: 'ANALYSIS_FILE_OVERSIZED',
      data: null,
    } as never

    const validated = validateEngineeringSnapshot(current)

    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.sections.flow.status).toBe('ready')
    expect(validated.sections.qor.status).toBe('ready')
  })

  it('rejects oversized persisted input before JSON parsing with stable sizes', () => {
    expect(
      parseEngineeringSnapshotJson(new Uint8Array(ENGINEERING_SNAPSHOT_MAX_BYTES + 1)),
    ).toEqual({
      ok: false,
      issue: {
        code: 'ENGINEERING_SNAPSHOT_TOO_LARGE',
        actualSizeBytes: ENGINEERING_SNAPSHOT_MAX_BYTES + 1,
        allowedSizeBytes: ENGINEERING_SNAPSHOT_MAX_BYTES,
      },
    })
  })

  it('rejects an incomplete envelope before exposing typed sections', () => {
    const { parameters: _parameters, ...incomplete } = snapshot()

    expect(validateEngineeringSnapshot(incomplete)).toEqual({
      ok: false,
      issue: { code: 'ENGINEERING_SNAPSHOT_INVALID' },
    })
  })

  it('accepts Runtime input while isolating its path-free Artifact section', () => {
    const runtime = snapshot()
    runtime.artifacts = runtime.artifacts.map(
      ({ reference: _reference, ...artifact }) => artifact,
    ) as never

    const validated = validateEngineeringSnapshot(runtime)

    expect(validated.ok && validated.sections).toMatchObject({
      artifacts: {
        status: 'unavailable',
        issues: [{ code: 'ENGINEERING_ARTIFACT_INVALID' }],
      },
      flow: { status: 'ready' },
      qor: { status: 'ready' },
      signoff: { status: 'ready' },
    })
  })

  it('requires normalized committed Subflow data in the current schema', () => {
    const current = snapshot()
    current.schemaVersion = 5
    current.analysis.steps[0]!.subflow = {
      status: 'available',
      steps: [
        {
          name: 'run sta',
          state: 'Success',
          runtime: '0:0:2',
          peakMemoryMb: 12.5,
        },
      ],
    }

    const valid = validateEngineeringSnapshot(current)
    expect(valid.ok && valid.sections.qor.status).toBe('ready')

    current.analysis.steps[0]!.subflow.steps[0]!.peakMemoryMb = Number.NaN
    const invalid = validateEngineeringSnapshot(current)
    expect(invalid.ok && invalid.sections.qor).toEqual({
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_QOR_INVALID' }],
    })
  })
})
