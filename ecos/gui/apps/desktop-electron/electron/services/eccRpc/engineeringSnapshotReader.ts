import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
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
