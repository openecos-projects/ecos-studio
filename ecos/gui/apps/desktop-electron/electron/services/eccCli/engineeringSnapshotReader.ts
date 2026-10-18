import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { EccPersistedEngineeringSnapshot, ReadSection } from '@ecos-studio/shared'
import {
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  validateEngineeringSnapshot,
} from '@ecos-studio/shared'

function readyData<T>(section: ReadSection<T>): T {
  if (section.status !== 'ready') throw new Error(section.issues[0]?.code)
  return section.data
}

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
  const { qorSnapshotExtension } = validated.sections
  return {
    ...validated.snapshot,
    artifacts: readyData(validated.sections.artifacts),
    checklist: readyData(validated.sections.checklist),
    flow: readyData(validated.sections.flow),
    hotspotPreview: readyData(validated.sections.hotspotPreview),
    metrics: readyData(validated.sections.metrics),
    ...(qorSnapshotExtension.status === 'ready'
      ? { qorSnapshotExtension: qorSnapshotExtension.data }
      : {}),
    signoffAssessment: readyData(validated.sections.signoff),
    timingPreview: readyData(validated.sections.timingPreview),
  }
}

export function hasPersistedWorkspace(directory: string): boolean {
  return existsSync(directory)
}
