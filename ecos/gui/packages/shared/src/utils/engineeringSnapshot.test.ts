import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { EccQorSnapshotExtension } from '../contracts/eccRuntime.ts'
import {
  ENGINEERING_SNAPSHOT_CHECKLIST_LIMIT,
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  ENGINEERING_SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_IDENTITY_MISMATCH,
  SNAPSHOT_REBUILD_REQUIRED,
  classifyWorkspaceOpenError,
  parseEngineeringSnapshotJson,
  validateEngineeringSnapshot,
} from './engineeringSnapshot'

// Copies of the pinned ECC canonical fixtures (ADR-0005) keep GUI tests independent
// of submodule checkout. CI's version job checks them against the ECC originals.
const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/snapshot')

function fixtureText(name: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, name), 'utf8')
}

function fixtureSnapshot(): Record<string, unknown> {
  return JSON.parse(fixtureText('v6-valid.json')) as Record<string, unknown>
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

describe('ECC canonical snapshot fixtures', () => {
  it('covers exactly the fixture set the ECC producer publishes', () => {
    expect(readdirSync(FIXTURE_ROOT).sort()).toEqual([
      'v6-invalid-artifact-absolute-reference.json',
      'v6-invalid-artifact-availability.json',
      'v6-invalid-artifact-parent-reference.json',
      'v6-invalid-missing-workspace-id.json',
      'v6-invalid-schema-version.json',
      'v6-valid.json',
    ])
  })

  it('accepts the valid fixture with every section ready', () => {
    const validated = parseEngineeringSnapshotJson(fixtureText('v6-valid.json'))

    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.snapshot).toEqual({
      cause: 'workspace.created',
      parameters: { design: 'gcd', frequency_mhz: 100 },
      schemaVersion: ENGINEERING_SNAPSHOT_SCHEMA_VERSION,
      workspaceId: 'workspace-fixture-v6',
      workspaceRevision: 1,
    })
    for (const [name, section] of Object.entries(validated.sections)) {
      expect(section.status, `section ${name}`).toBe('ready')
    }
    expect(
      validated.sections.artifacts.status === 'ready' &&
        validated.sections.artifacts.data.length,
    ).toBeGreaterThan(0)
    expect(
      validated.sections.checklist.status === 'ready' &&
        validated.sections.checklist.data.items[0],
    ).toMatchObject({
      id: 'synthesis.netlist',
      blocked: false,
      state: 'pass',
    })
    expect(
      validated.sections.timingPreview.status === 'ready' &&
        validated.sections.timingPreview.data,
    ).toMatchObject({ issueCount: 7, issuesTruncated: true })
    expect(
      validated.sections.hotspotPreview.status === 'ready' &&
        validated.sections.hotspotPreview.data,
    ).toMatchObject({ hotspotCount: 2, hotspotsTruncated: false })
  })

  it.each([
    [
      'v6-invalid-schema-version.json',
      'ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED',
      SNAPSHOT_REBUILD_REQUIRED,
    ],
    [
      'v6-invalid-missing-workspace-id.json',
      'ENGINEERING_SNAPSHOT_INVALID',
      SNAPSHOT_REBUILD_REQUIRED,
    ],
    [
      'v6-invalid-artifact-absolute-reference.json',
      'ENGINEERING_ARTIFACT_INVALID',
      SNAPSHOT_REBUILD_REQUIRED,
    ],
    [
      'v6-invalid-artifact-parent-reference.json',
      'ENGINEERING_ARTIFACT_INVALID',
      SNAPSHOT_REBUILD_REQUIRED,
    ],
    [
      'v6-invalid-artifact-availability.json',
      'ENGINEERING_ARTIFACT_INVALID',
      SNAPSHOT_REBUILD_REQUIRED,
    ],
  ])('rejects %s with a stable fail-closed issue', (name, code, recovery) => {
    expect(parseEngineeringSnapshotJson(fixtureText(name))).toEqual({
      ok: false,
      issue: expect.objectContaining({ code, recovery }),
    })
  })
})

describe('classifyWorkspaceOpenError', () => {
  it('classifies the stable ECC open-failure codes from the error code field', () => {
    expect(
      classifyWorkspaceOpenError(
        Object.assign(new Error('invalid Engineering Snapshot'), {
          code: SNAPSHOT_REBUILD_REQUIRED,
        }),
      ),
    ).toBe(SNAPSHOT_REBUILD_REQUIRED)
    expect(
      classifyWorkspaceOpenError(
        Object.assign(new Error('Engineering Snapshot workspace identity mismatch'), {
          code: SNAPSHOT_IDENTITY_MISMATCH,
        }),
      ),
    ).toBe(SNAPSHOT_IDENTITY_MISMATCH)
  })

  it('falls back to an exact wire message match', () => {
    expect(classifyWorkspaceOpenError(new Error(SNAPSHOT_REBUILD_REQUIRED))).toBe(
      SNAPSHOT_REBUILD_REQUIRED,
    )
    expect(classifyWorkspaceOpenError(new Error(SNAPSHOT_IDENTITY_MISMATCH))).toBe(
      SNAPSHOT_IDENTITY_MISMATCH,
    )
  })

  it('never matches substrings or unrelated failures', () => {
    expect(
      classifyWorkspaceOpenError(
        new Error(`open failed: ${SNAPSHOT_REBUILD_REQUIRED} (corrupt)`),
      ),
    ).toBeNull()
    expect(classifyWorkspaceOpenError(new Error('Workspace not found'))).toBeNull()
    expect(classifyWorkspaceOpenError('snapshot_rebuild_required')).toBeNull()
    expect(classifyWorkspaceOpenError(null)).toBeNull()
    expect(classifyWorkspaceOpenError(undefined)).toBeNull()
  })
})

describe('Engineering Snapshot v6 envelope', () => {
  it('is a tolerant reader for unknown fields at every level', () => {
    const snapshot = fixtureSnapshot()
    snapshot.futureTopLevelField = { anything: true }
    const artifacts = snapshot.artifacts as Array<Record<string, unknown>>
    artifacts[0] = { ...artifacts[0], futureArtifactField: 42 }
    const checklist = snapshot.checklist as { items: Array<Record<string, unknown>> }
    checklist.items[0] = { ...checklist.items[0], futureItemField: 'x' }

    const validated = validateEngineeringSnapshot(snapshot)

    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.sections.artifacts.status).toBe('ready')
    expect(validated.sections.checklist.status).toBe('ready')
  })

  it('ignores legacy artifact fingerprint fields instead of rejecting them', () => {
    const snapshot = fixtureSnapshot()
    const artifacts = snapshot.artifacts as Array<Record<string, unknown>>
    artifacts[0] = {
      ...artifacts[0],
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
      integrity: { mode: 'legacy' },
    }

    const validated = validateEngineeringSnapshot(snapshot)

    expect(validated.ok).toBe(true)
    expect(validated.ok && validated.sections.artifacts.status).toBe('ready')
  })

  it.each([5, 7, 0, -1])(
    'fails closed with rebuild semantics for unsupported schemaVersion %s',
    (schemaVersion) => {
      expect(
        validateEngineeringSnapshot({ ...fixtureSnapshot(), schemaVersion }),
      ).toEqual({
        ok: false,
        issue: {
          code: 'ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED',
          detail: `schemaVersion ${schemaVersion}`,
          recovery: SNAPSHOT_REBUILD_REQUIRED,
        },
      })
    },
  )

  it.each([undefined, '6', 6.5, null])(
    'rejects a non-integer schemaVersion %s as invalid rather than unsupported',
    (schemaVersion) => {
      expect(
        validateEngineeringSnapshot({ ...fixtureSnapshot(), schemaVersion }),
      ).toEqual({
        ok: false,
        issue: {
          code: 'ENGINEERING_SNAPSHOT_INVALID',
          recovery: SNAPSHOT_REBUILD_REQUIRED,
        },
      })
    },
  )

  it('fails closed on workspace identity mismatch without offering a rebuild', () => {
    expect(validateEngineeringSnapshot(fixtureSnapshot(), 'workspace-other')).toEqual({
      ok: false,
      issue: { code: 'ENGINEERING_WORKSPACE_ID_MISMATCH' },
    })
  })

  it('rejects malformed containers instead of degrading them to empty sections', () => {
    for (const key of [
      'flow',
      'checklist',
      'signoffAssessment',
      'timingPreview',
      'hotspotPreview',
    ]) {
      expect(validateEngineeringSnapshot({ ...fixtureSnapshot(), [key]: [] }).ok).toBe(
        false,
      )
    }
    expect(validateEngineeringSnapshot({ ...fixtureSnapshot(), metrics: {} }).ok).toBe(
      false,
    )
    expect(validateEngineeringSnapshot({ ...fixtureSnapshot(), artifacts: {} }).ok).toBe(
      false,
    )
  })

  it('carries a valid stale predecessor through the envelope', () => {
    const snapshot = {
      ...fixtureSnapshot(),
      stalePredecessor: {
        workspaceRevision: 3,
        invalidatedStepIds: ['sta'],
      },
    }

    const validated = validateEngineeringSnapshot(snapshot)

    expect(validated.ok).toBe(true)
    expect(validated.ok && validated.snapshot.stalePredecessor).toEqual({
      workspaceRevision: 3,
      invalidatedStepIds: ['sta'],
    })
  })

  it('rejects a malformed stale predecessor', () => {
    const snapshot = {
      ...fixtureSnapshot(),
      stalePredecessor: { workspaceRevision: 0, invalidatedStepIds: ['sta'] },
    }

    expect(validateEngineeringSnapshot(snapshot)).toEqual({
      ok: false,
      issue: {
        code: 'ENGINEERING_SNAPSHOT_INVALID',
        recovery: SNAPSHOT_REBUILD_REQUIRED,
      },
    })
  })
})

describe('Engineering Snapshot v6 sections', () => {
  it('degrades a malformed metric without rejecting the snapshot', () => {
    const snapshot = fixtureSnapshot()
    snapshot.metrics = [
      ...(snapshot.metrics as unknown[]),
      { id: 'broken', display_name: 'Broken' },
    ]

    const validated = validateEngineeringSnapshot(snapshot)

    expect(validated.ok).toBe(true)
    expect(validated.ok && validated.sections.metrics).toEqual({
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_METRICS_INVALID' }],
    })
    expect(validated.ok && validated.sections.flow.status).toBe('ready')
  })

  it('degrades malformed flow, signoff, checklist, and preview payloads independently', () => {
    const cases: Array<[string, string, unknown, string]> = [
      ['flow', 'flow', { steps: [{ name: 'sta' }] }, 'ENGINEERING_FLOW_INVALID'],
      [
        'signoffAssessment',
        'signoff',
        { status: 'ready', groups: [], risks: {} },
        'ENGINEERING_SIGNOFF_INVALID',
      ],
      [
        'checklist',
        'checklist',
        { items: [{ id: 'x' }] },
        'ENGINEERING_CHECKLIST_INVALID',
      ],
      [
        'timingPreview',
        'timingPreview',
        { issues: [], issueCount: -1, issuesTruncated: false },
        'ENGINEERING_TIMING_PREVIEW_INVALID',
      ],
      [
        'hotspotPreview',
        'hotspotPreview',
        { hotspots: [{ kind: 'congestion' }], hotspotCount: 1, hotspotsTruncated: false },
        'ENGINEERING_HOTSPOT_PREVIEW_INVALID',
      ],
    ]
    for (const [key, sectionName, value, code] of cases) {
      const validated = validateEngineeringSnapshot({
        ...fixtureSnapshot(),
        [key]: value,
      })
      expect(validated.ok).toBe(true)
      if (!validated.ok) continue
      const section = validated.sections[sectionName as keyof typeof validated.sections]
      expect(section).toEqual({
        status: 'unavailable',
        issues: [{ code }],
      })
    }
  })

  it('degrades an over-limit checklist projection instead of flowing it through', () => {
    const snapshot = fixtureSnapshot()
    const item = (snapshot.checklist as { items: Array<Record<string, unknown>> })
      .items[0]!
    snapshot.checklist = {
      items: Array.from({ length: ENGINEERING_SNAPSHOT_CHECKLIST_LIMIT + 1 }, () => item),
    }

    const validated = validateEngineeringSnapshot(snapshot)

    expect(validated.ok).toBe(true)
    expect(validated.ok && validated.sections.checklist).toEqual({
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_CHECKLIST_INVALID' }],
    })
  })

  it('fails closed on an unsafe artifact reference even when every section is sound', () => {
    const snapshot = fixtureSnapshot()
    const artifacts = snapshot.artifacts as Array<Record<string, unknown>>
    artifacts[0] = { ...artifacts[0], reference: '../outside.json' }

    expect(validateEngineeringSnapshot(snapshot)).toEqual({
      ok: false,
      issue: {
        code: 'ENGINEERING_ARTIFACT_INVALID',
        recovery: SNAPSHOT_REBUILD_REQUIRED,
      },
    })
  })

  it('rejects duplicate artifact identities', () => {
    const snapshot = fixtureSnapshot()
    const artifacts = snapshot.artifacts as Array<Record<string, unknown>>
    artifacts.push({ ...artifacts[0]! })

    expect(validateEngineeringSnapshot(snapshot).ok).toBe(false)
  })
})

describe('QoR Snapshot extension section', () => {
  function snapshotWithExtension(
    mutate?: (extension: EccQorSnapshotExtension) => void,
  ): Record<string, unknown> {
    const snapshot = fixtureSnapshot()
    const extension = qorSnapshotExtension()
    mutate?.(extension)
    snapshot.qorSnapshotExtension = extension
    return snapshot
  }

  it('exposes a valid extension and degrades a malformed one', () => {
    const valid = validateEngineeringSnapshot(snapshotWithExtension())
    expect(valid.ok).toBe(true)
    if (!valid.ok) return
    expect(valid.sections.qorSnapshotExtension).toMatchObject({
      status: 'ready',
      data: { scoringEngine: 'qor-v3', qphys: { timing: { value: 84 } } },
    })

    const invalid = validateEngineeringSnapshot(
      snapshotWithExtension((extension) => {
        extension.qphys = [] as never
      }),
    )
    expect(invalid.ok && invalid.sections.qorSnapshotExtension).toEqual({
      status: 'unavailable',
      issues: [{ code: 'ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID' }],
    })
  })

  it.each([
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
      'out-of-range score',
      (extension: EccQorSnapshotExtension) => {
        extension.score = 101
      },
    ],
    [
      'unavailable without reason',
      (extension: EccQorSnapshotExtension) => {
        extension.status = 'unavailable'
      },
    ],
    [
      'overlong text',
      (extension: EccQorSnapshotExtension) => {
        extension.diagnoses[0]!.diagnosisId = 'x'.repeat(513)
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    expect(validateEngineeringSnapshot(snapshotWithExtension(mutate))).toMatchObject({
      ok: true,
      sections: {
        qorSnapshotExtension: {
          status: 'unavailable',
          issues: [{ code: 'ENGINEERING_QOR_SNAPSHOT_EXTENSION_INVALID' }],
        },
      },
    })
  })
})

describe('parseEngineeringSnapshotJson', () => {
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

  it('rejects non-object JSON as invalid', () => {
    expect(parseEngineeringSnapshotJson('[1,2,3]')).toEqual({
      ok: false,
      issue: {
        code: 'ENGINEERING_SNAPSHOT_INVALID',
        recovery: SNAPSHOT_REBUILD_REQUIRED,
      },
    })
    expect(parseEngineeringSnapshotJson('{broken json')).toEqual({
      ok: false,
      issue: {
        code: 'ENGINEERING_SNAPSHOT_INVALID',
        recovery: SNAPSHOT_REBUILD_REQUIRED,
      },
    })
  })
})
