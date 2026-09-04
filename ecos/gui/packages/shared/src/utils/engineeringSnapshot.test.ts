import { describe, expect, it } from 'vitest'
import {
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  parseEngineeringSnapshotJson,
  validateEngineeringSnapshot,
} from './engineeringSnapshot'

const metric = {
  id: 'sta_setup_wns',
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

function snapshot() {
  const artifact = {
    artifactId: 'artifact-metrics',
    availability: 'available',
    kind: 'qor_metrics',
    name: 'qor_metrics.json',
    reference: 'sta_ecc/analysis/qor_metrics.json',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    stepId: 'sta',
  }
  return {
    schemaVersion: 1,
    workspaceId: 'engineering-workspace',
    workspaceRevision: 14,
    cause: 'flow_step.success',
    flow: { steps: [{ name: 'sta', tool: 'ecc', state: 'Success' }] },
    parameters: {},
    checklist: {},
    metrics: [metric],
    qorAssessment: {
      status: 'ready',
      score: { value: 84, threshold: 60, gate: 'pass' },
      metrics: [metric],
      steps: [
        {
          stepId: 'sta',
          order: 0,
          name: 'sta',
          status: 'pass',
          summaryMetricCount: 1,
        },
      ],
    },
    signoffAssessment: { status: 'ready', groups: [], risks: [] },
    analysis: {
      steps: [
        {
          stepId: 'sta',
          toolId: 'ecc',
          order: 0,
          flowState: 'Success',
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

describe('Engineering Snapshot validation', () => {
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
    current.schemaVersion = 2
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
