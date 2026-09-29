import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPersistedEngineeringSnapshot } from './engineeringSnapshotReader'

// The renderer never touches snapshot files; this reader is the backend
// boundary. It uses the same pinned ECC fixture copies as the shared validator;
// CI's version job checks them against the ECC originals (ADR-0005).
const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/shared/src/utils/fixtures/snapshot',
)

function fixtureText(name: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, name), 'utf8')
}

describe('readPersistedEngineeringSnapshot', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ecc-snapshot-reader-'))
    mkdirSync(join(directory, 'home'), { recursive: true })
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  function writeSnapshot(name: string): void {
    writeFileSync(join(directory, 'home', 'engineering-snapshot.json'), fixtureText(name))
  }

  it('returns the typed v6 snapshot for the canonical valid fixture', async () => {
    writeSnapshot('v6-valid.json')

    const snapshot = await readPersistedEngineeringSnapshot(
      directory,
      'workspace-fixture-v6',
    )

    expect(snapshot.schemaVersion).toBe(6)
    expect(snapshot.workspaceId).toBe('workspace-fixture-v6')
    expect(snapshot.cause).toBe('workspace.created')
    expect(snapshot.metrics.length).toBeGreaterThan(0)
    expect(snapshot.artifacts[0]).toMatchObject({
      availability: 'available',
      kind: 'qor_metrics',
    })
    expect(snapshot.checklist.items[0]).toMatchObject({ id: 'synthesis.netlist' })
    expect(snapshot.timingPreview.issuesTruncated).toBe(true)
    expect(snapshot.signoffAssessment.status).toBe('blocked')
  })

  it.each([
    ['v6-invalid-schema-version.json', 'ENGINEERING_SNAPSHOT_SCHEMA_UNSUPPORTED'],
    ['v6-invalid-missing-workspace-id.json', 'ENGINEERING_SNAPSHOT_INVALID'],
    ['v6-invalid-artifact-absolute-reference.json', 'ENGINEERING_ARTIFACT_INVALID'],
    ['v6-invalid-artifact-parent-reference.json', 'ENGINEERING_ARTIFACT_INVALID'],
    ['v6-invalid-artifact-availability.json', 'ENGINEERING_ARTIFACT_INVALID'],
  ])('rejects %s with %s', async (name, code) => {
    writeSnapshot(name)

    await expect(readPersistedEngineeringSnapshot(directory)).rejects.toThrow(code)
  })

  it('fails closed on workspace identity mismatch', async () => {
    writeSnapshot('v6-valid.json')

    await expect(
      readPersistedEngineeringSnapshot(directory, 'workspace-other'),
    ).rejects.toThrow('ENGINEERING_WORKSPACE_ID_MISMATCH')
  })
})
