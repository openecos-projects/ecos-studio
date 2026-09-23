import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { EccPersistedEngineeringSnapshot } from '@ecos-studio/shared'
import {
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  validateEngineeringSnapshot,
} from '@ecos-studio/shared'

export async function readPersistedEngineeringSnapshot(
  directory: string,
  expectedWorkspaceId?: string,
): Promise<EccPersistedEngineeringSnapshot> {
  const path = join(directory, 'home', 'engineering-snapshot.json')
  let content: string
  try {
    if ((await stat(path)).size > ENGINEERING_SNAPSHOT_MAX_BYTES) {
      throw new Error('ENGINEERING_SNAPSHOT_TOO_LARGE')
    }
    content = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `ENGINEERING_SNAPSHOT_READ_FAILED: ${error.message}`
        : 'ENGINEERING_SNAPSHOT_READ_FAILED',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('ENGINEERING_SNAPSHOT_INVALID')
  }
  const validated = validateEngineeringSnapshot(parsed, expectedWorkspaceId)
  if (!validated.ok) throw new Error(validated.issue.code)
  const { artifacts, flow, qor, signoff } = validated.sections
  if (artifacts.status !== 'ready') throw new Error(artifacts.issues[0]?.code)
  if (flow.status !== 'ready') throw new Error(flow.issues[0]?.code)
  if (qor.status !== 'ready') throw new Error(qor.issues[0]?.code)
  const qorSnapshotExtension = validated.sections.qorSnapshotExtension
  if (qorSnapshotExtension.status !== 'ready') {
    throw new Error(qorSnapshotExtension.issues[0]?.code)
  }
  if (signoff.status !== 'ready') throw new Error(signoff.issues[0]?.code)
  return {
    ...validated.snapshot,
    analysis: qor.data.analysis,
    artifacts: artifacts.data,
    flow: flow.data,
    metrics: qor.data.metrics,
    qorSnapshotExtension: qorSnapshotExtension.data,
    signoffAssessment: signoff.data,
  }
}

export function hasPersistedWorkspace(directory: string): boolean {
  return existsSync(directory)
}

/**
 * Signoff is an evidence boundary. Recheck the committed artifact fingerprints
 * immediately before exporting so a current-mode drift warning cannot silently
 * turn into a trusted package.
 */
export async function findPersistedArtifactDrift(
  directory: string,
  snapshot: EccPersistedEngineeringSnapshot,
): Promise<string[]> {
  const root = resolve(directory)
  const drifted: string[] = []
  for (const artifact of snapshot.artifacts) {
    if (
      artifact.availability !== 'available' ||
      artifact.sha256 === undefined ||
      artifact.sizeBytes === undefined
    ) {
      continue
    }
    if (
      await persistedArtifactDrifted(
        root,
        artifact.reference,
        artifact.sha256,
        artifact.sizeBytes,
      )
    ) {
      drifted.push(artifact.reference)
    }
  }
  return drifted
}

async function persistedArtifactDrifted(
  root: string,
  reference: string,
  expectedSha256: string,
  expectedSizeBytes: number,
): Promise<boolean> {
  const candidate = resolve(root, reference)
  if (
    isAbsolute(reference) ||
    candidate === root ||
    relative(root, candidate).startsWith('..')
  ) {
    return true
  }
  let canonicalPath: string
  try {
    canonicalPath = await realpath(candidate)
    if (canonicalPath === root || relative(root, canonicalPath).startsWith('..'))
      return true
    const before = await stat(canonicalPath)
    if (!before.isFile() || before.size !== expectedSizeBytes) return true
    const digest = await digestFile(canonicalPath)
    const after = await stat(canonicalPath)
    return (
      !after.isFile() ||
      after.size !== expectedSizeBytes ||
      digest.sizeBytes !== expectedSizeBytes ||
      digest.sha256 !== expectedSha256
    )
  } catch {
    return true
  }
}

async function digestFile(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const handle = await open(path, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.alloc(1024 * 1024)
  let sizeBytes = 0
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      sizeBytes += bytesRead
    }
  } finally {
    await handle.close()
  }
  return { sha256: hash.digest('hex'), sizeBytes }
}
