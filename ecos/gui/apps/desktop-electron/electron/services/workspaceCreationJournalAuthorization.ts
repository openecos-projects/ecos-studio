import { isAbsolute } from 'node:path'
import { isPathWithinRoot } from './pathScope'
import {
  normalizeCreationPath,
  type CreationJournalRecord,
} from './workspaceCreationJournalRecord'

export interface CreationPathAuthorizer {
  canonicalizePaths(
    projectRoot: string,
    targetDirectory: string,
  ): Promise<{ projectRoot: string; targetDirectory: string }>
}

export async function authorizeCreationRecord(
  authorizer: CreationPathAuthorizer,
  record: CreationJournalRecord,
): Promise<void> {
  if (
    !isAbsolute(record.targetDirectory) ||
    !isAbsolute(record.intent.projectRoot) ||
    !isPathWithinRoot(record.targetDirectory, record.intent.projectRoot)
  ) {
    throw new Error('Workspace creation journal path is outside the Project root.')
  }
  const canonical = await authorizer.canonicalizePaths(
    record.intent.projectRoot,
    record.targetDirectory,
  )
  if (
    normalizeCreationPath(canonical.projectRoot) !==
      normalizeCreationPath(record.intent.projectRoot) ||
    normalizeCreationPath(canonical.targetDirectory) !==
      normalizeCreationPath(record.targetDirectory)
  ) {
    throw new Error('Workspace creation journal paths are no longer canonical.')
  }
}

export function requireActiveCreationOwner(
  record: CreationJournalRecord,
  ownerWindowId: number,
): void {
  if (record.status !== 'active' || record.ownerWindowId !== ownerWindowId) {
    throw new Error('Workspace creation action is not owned by this window.')
  }
}

export function requireCreationRecovery(record: CreationJournalRecord): void {
  if (record.status !== 'unfinished') {
    throw new Error('Workspace creation is not awaiting recovery.')
  }
}

export function workspaceCreationIdentityMatches(
  record: CreationJournalRecord,
  identity: { workspaceId?: string; workspaceRevision?: number },
): boolean {
  return !(
    (record.workspaceId && identity.workspaceId !== record.workspaceId) ||
    (record.workspaceRevision !== undefined &&
      identity.workspaceRevision !== record.workspaceRevision)
  )
}

export async function creationTargetExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return false
    throw error
  }
}

export function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : undefined
}
import { stat } from 'node:fs/promises'
