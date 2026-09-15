import { resolve } from 'node:path'
import type {
  EccBackgroundWorkspaceCreation,
  EccWorkspaceCreationStage,
} from '@ecos-studio/shared'

export interface RegistrationOwnership {
  beforeFingerprint: string | null
  introduced?: boolean
  registeredFingerprint?: string
}

export interface CreationJournalRecord {
  applicationRegistration: RegistrationOwnership
  commandId: string
  createdAt: number
  creationId: string
  intent: {
    projectId?: string
    projectRoot: string
    workspaceBindings: Record<string, unknown>
    workspaceSpec: Record<string, unknown>
  }
  issue?: string
  manifestRegistration?: RegistrationOwnership & {
    workspaceId: string
    workspacePath: string
  }
  ownerWindowId: number
  stage: EccWorkspaceCreationStage
  status: 'active' | 'unfinished'
  targetDirectory: string
  targetExistedBefore: boolean
  updatedAt: number
  version: 1
  workspaceId?: string
  workspaceRevision?: number
}

export function projectCreationRecord(
  record: CreationJournalRecord,
): EccBackgroundWorkspaceCreation {
  return {
    commandId: record.commandId,
    creationId: record.creationId,
    ...(record.issue ? { issue: record.issue } : {}),
    ownerWindowId: record.ownerWindowId,
    ...(record.intent.projectId ? { projectId: record.intent.projectId } : {}),
    projectRoot: record.intent.projectRoot,
    stage: record.stage,
    status: record.status,
    targetDirectory: record.targetDirectory,
    targetExistedBefore: record.targetExistedBefore,
    updatedAt: record.updatedAt,
  }
}

export function isCreationJournalRecord(value: unknown): value is CreationJournalRecord {
  if (!isRecord(value)) return false
  const intent = value.intent
  return (
    value.version === 1 &&
    isNonEmptyString(value.commandId) &&
    isNonEmptyString(value.creationId) &&
    typeof value.ownerWindowId === 'number' &&
    Number.isInteger(value.ownerWindowId) &&
    value.ownerWindowId >= 0 &&
    isNonEmptyString(value.targetDirectory) &&
    typeof value.targetExistedBefore === 'boolean' &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    isRegistrationOwnership(value.applicationRegistration) &&
    (value.manifestRegistration === undefined ||
      (isRecord(value.manifestRegistration) &&
        isRegistrationOwnership(value.manifestRegistration) &&
        isNonEmptyString(value.manifestRegistration.workspaceId) &&
        isNonEmptyString(value.manifestRegistration.workspacePath))) &&
    (value.status === 'active' || value.status === 'unfinished') &&
    (value.issue === undefined ||
      (typeof value.issue === 'string' && value.issue.length <= 500)) &&
    [
      'intent-recorded',
      'workspace-created',
      'manifest-registered',
      'application-registered',
      'completed',
    ].includes(String(value.stage)) &&
    isRecord(intent) &&
    isNonEmptyString(intent.projectRoot) &&
    (intent.projectId === undefined || isNonEmptyString(intent.projectId)) &&
    isRecord(intent.workspaceBindings) &&
    isRecord(intent.workspaceSpec) &&
    (value.workspaceId === undefined || isNonEmptyString(value.workspaceId)) &&
    (value.workspaceRevision === undefined ||
      (typeof value.workspaceRevision === 'number' &&
        Number.isInteger(value.workspaceRevision) &&
        value.workspaceRevision >= 0)) &&
    hasValidStageEvidence(value)
  )
}

export function sanitizedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (key, item) =>
      /password|secret|token|credential/i.test(key) ? undefined : item,
    ),
  ) as Record<string, unknown>
}

export function boundedIssue(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500)
}

export function fingerprint(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

export function normalizeCreationPath(path: string): string {
  const normalized = resolve(path).replace(/\\/g, '/')
  return normalized.length > 1 ? normalized.replace(/\/+$/g, '') : normalized
}

export function basenameCreationPath(path: string): string {
  return normalizeCreationPath(path).split('/').filter(Boolean).pop() ?? ''
}

export function stageRank(stage: EccWorkspaceCreationStage): number {
  return [
    'intent-recorded',
    'workspace-created',
    'manifest-registered',
    'application-registered',
    'completed',
  ].indexOf(stage)
}

export function monotonicCreationStage(
  current: EccWorkspaceCreationStage,
  next: EccWorkspaceCreationStage,
): EccWorkspaceCreationStage {
  return stageRank(next) > stageRank(current) ? next : current
}

function isRegistrationOwnership(value: unknown): value is RegistrationOwnership {
  if (!isRecord(value)) return false
  return (
    (value.beforeFingerprint === null || typeof value.beforeFingerprint === 'string') &&
    (value.introduced === undefined || typeof value.introduced === 'boolean') &&
    (value.registeredFingerprint === undefined ||
      typeof value.registeredFingerprint === 'string')
  )
}

function hasValidStageEvidence(value: Record<string, unknown>): boolean {
  const rank = stageRank(value.stage as EccWorkspaceCreationStage)
  if (rank < 0) return false
  const manifest = value.manifestRegistration
  if (
    rank >= stageRank('manifest-registered') &&
    manifest !== undefined &&
    (!isRecord(manifest) ||
      !isNonEmptyString(manifest.registeredFingerprint) ||
      typeof manifest.introduced !== 'boolean')
  ) {
    return false
  }
  if (rank >= stageRank('application-registered')) {
    const application = value.applicationRegistration
    if (
      !isRecord(application) ||
      !isNonEmptyString(application.registeredFingerprint) ||
      typeof application.introduced !== 'boolean'
    ) {
      return false
    }
  }
  return true
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
