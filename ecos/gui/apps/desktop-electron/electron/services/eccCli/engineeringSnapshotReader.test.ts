import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPersistedEngineeringSnapshot } from './engineeringSnapshotReader'

// The renderer never touches snapshot files; this reader is the backend
// boundary. It is exercised here against the ECC canonical fixtures, consumed
// read-only from the monorepo's ecc/ submodule checkout (ADR-0005).
const FIXTURE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../ecc/test/formal/fixtures/snapshot',
)

function fixtureText(name: string): string {
  if (!existsSync(FIXTURE_ROOT)) {
    throw new Error(
      `ECC canonical snapshot fixtures not found at ${FIXTURE_ROOT}. ` +
        'Run these tests from the ECOS Studio monorepo with the ecc/ submodule checked out.',
    )
  }
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

  it('preserves workspace configuration and bindings for backend consumers', async () => {
    const workspaceSpec = {
      design: { topModule: 'gcd', clockPort: 'clk' },
      inputs: [{ inputId: 'filelist', role: 'filelist' }],
      pdk: { name: 'icsprout55' },
      extension: { producerOption: true },
    }
    const workspaceBindings = {
      inputs: { filelist: join(directory, 'origin', 'sources.f') },
      pdk: { root: '/pdks/icsprout55', version: '1' },
    }
    writeFileSync(
      join(directory, 'home', 'engineering-snapshot.json'),
      JSON.stringify({
        ...JSON.parse(fixtureText('v6-valid.json')),
        workspaceSpec,
        workspaceBindings,
        unknownProjection: { ignored: true },
      }),
    )

    const snapshot = await readPersistedEngineeringSnapshot(directory)

    expect(snapshot.workspaceSpec).toEqual(workspaceSpec)
    expect(snapshot.workspaceBindings).toEqual(workspaceBindings)
    expect(snapshot).not.toHaveProperty('unknownProjection')
  })

  it.each([4, 6])(
    'accepts v%s snapshots without optional workspace configuration',
    async (schemaVersion) => {
      const snapshot = JSON.parse(fixtureText('v6-valid.json'))
      snapshot.schemaVersion = schemaVersion
      delete snapshot.workspaceSpec
      delete snapshot.workspaceBindings
      writeFileSync(
        join(directory, 'home', 'engineering-snapshot.json'),
        JSON.stringify(snapshot),
      )

      const result = await readPersistedEngineeringSnapshot(directory)

      expect(result.workspaceSpec).toBeUndefined()
      expect(result.workspaceBindings).toBeUndefined()
    },
  )

  it.each(['workspaceSpec', 'workspaceBindings'] as const)(
    'rejects malformed %s containers',
    async (field) => {
      for (const value of [null, [], 'invalid', 1, true]) {
        writeFileSync(
          join(directory, 'home', 'engineering-snapshot.json'),
          JSON.stringify({ ...JSON.parse(fixtureText('v6-valid.json')), [field]: value }),
        )

        await expect(readPersistedEngineeringSnapshot(directory)).rejects.toThrow(
          'ENGINEERING_SNAPSHOT_INVALID',
        )
      }
    },
  )

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
