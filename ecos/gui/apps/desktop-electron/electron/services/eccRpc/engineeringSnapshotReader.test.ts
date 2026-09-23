import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EccPersistedEngineeringSnapshot } from '@ecos-studio/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { findPersistedArtifactDrift } from './engineeringSnapshotReader'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

function snapshotFor(
  reference: string,
  content: string,
): EccPersistedEngineeringSnapshot {
  return {
    artifacts: [
      {
        artifactId: 'artifact-a',
        availability: 'available',
        kind: 'report_text',
        name: reference,
        reference,
        sha256: createHash('sha256').update(content).digest('hex'),
        sizeBytes: Buffer.byteLength(content),
        stepId: 'STA',
      },
    ],
  } as EccPersistedEngineeringSnapshot
}

describe('findPersistedArtifactDrift', () => {
  it('accepts unchanged files and reports modified or missing files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'engineering-snapshot-'))
    temporaryDirectories.push(directory)
    const reference = 'reports/qor.json'
    const original = '{"status":"ready"}'
    await mkdir(join(directory, 'reports'), { recursive: true })
    await writeFile(join(directory, reference), original)
    const snapshot = snapshotFor(reference, original)

    await expect(findPersistedArtifactDrift(directory, snapshot)).resolves.toEqual([])

    await writeFile(join(directory, reference), '{"status":"changed"}')
    await expect(findPersistedArtifactDrift(directory, snapshot)).resolves.toEqual([
      reference,
    ])

    await rm(join(directory, reference))
    await expect(findPersistedArtifactDrift(directory, snapshot)).resolves.toEqual([
      reference,
    ])
  })

  it('treats an artifact reference that escapes the workspace as drift', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'engineering-snapshot-'))
    temporaryDirectories.push(directory)
    const snapshot = snapshotFor('../outside.json', '{}')

    await expect(findPersistedArtifactDrift(directory, snapshot)).resolves.toEqual([
      '../outside.json',
    ])
  })
})
