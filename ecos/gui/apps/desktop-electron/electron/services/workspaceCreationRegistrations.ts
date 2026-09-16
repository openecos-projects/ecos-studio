import type { DesktopSettingsValue } from '@ecos-studio/shared'
import type { ProjectManifestService } from './projectManifestService'
import {
  basenameCreationPath,
  fingerprint,
  normalizeCreationPath,
  type CreationJournalRecord,
} from './workspaceCreationJournalRecord'

export interface WorkspaceCreationRegistrationOptions {
  isWorkspace(path: string): Promise<boolean>
  projectManifestService: Pick<
    ProjectManifestService,
    | 'ensureWorkspaceRegistration'
    | 'inspectWorkspaceRegistration'
    | 'removeWorkspaceRegistration'
  >
  settingsStore: {
    get<T extends DesktopSettingsValue = DesktopSettingsValue>(
      key: string,
    ): Promise<T | null>
    set(key: string, value: DesktopSettingsValue): Promise<void>
  }
}

export async function captureRegistrationOwnership(
  options: WorkspaceCreationRegistrationOptions,
  projectRoot: string,
  targetDirectory: string,
  projectId?: string,
): Promise<
  Pick<CreationJournalRecord, 'applicationRegistration' | 'manifestRegistration'>
> {
  const managed =
    normalizeCreationPath(projectRoot) !== normalizeCreationPath(targetDirectory)
  const manifestBefore = managed
    ? await options.projectManifestService.inspectWorkspaceRegistration(
        projectRoot,
        targetDirectory,
        projectId,
      )
    : null
  const recentBefore = await recentWorkspaceEntry(options, targetDirectory)
  return {
    applicationRegistration: {
      beforeFingerprint: recentBefore ? fingerprint(recentBefore) : null,
    },
    ...(managed
      ? {
          manifestRegistration: {
            beforeFingerprint: manifestBefore?.fingerprint ?? null,
            workspaceId: basenameCreationPath(targetDirectory),
            workspacePath: normalizeCreationPath(targetDirectory),
          },
        }
      : {}),
  }
}

export async function confirmManifestRegistration(
  options: WorkspaceCreationRegistrationOptions,
  record: CreationJournalRecord,
  ensure: boolean,
): Promise<CreationJournalRecord> {
  const ownership = record.manifestRegistration
  if (!ownership) return record
  const evidence = ensure
    ? await options.projectManifestService.ensureWorkspaceRegistration(
        record.intent.projectRoot,
        record.targetDirectory,
        record.intent.projectId,
      )
    : await options.projectManifestService.inspectWorkspaceRegistration(
        record.intent.projectRoot,
        record.targetDirectory,
        record.intent.projectId,
      )
  if (!evidence) {
    throw new Error('Project manifest does not contain the created Workspace.')
  }
  return {
    ...record,
    manifestRegistration: {
      ...ownership,
      introduced: ownership.beforeFingerprint === null,
      registeredFingerprint: evidence.fingerprint,
    },
  }
}

export async function confirmApplicationRegistration(
  options: WorkspaceCreationRegistrationOptions,
  record: CreationJournalRecord,
  ensure: boolean,
): Promise<CreationJournalRecord> {
  const entry = ensure
    ? await ensureRecentWorkspaceEntry(options, record.targetDirectory)
    : await recentWorkspaceEntry(options, record.targetDirectory)
  if (!entry) throw new Error('Workspace was not added to recent Workspaces.')
  return {
    ...record,
    applicationRegistration: {
      ...record.applicationRegistration,
      introduced: record.applicationRegistration.beforeFingerprint === null,
      registeredFingerprint: fingerprint(entry),
    },
  }
}

export async function removeOwnedRegistrations(
  options: WorkspaceCreationRegistrationOptions,
  record: CreationJournalRecord,
): Promise<void> {
  const manifest = record.manifestRegistration
  const currentManifest =
    manifest?.beforeFingerprint === null
      ? await options.projectManifestService.inspectWorkspaceRegistration(
          record.intent.projectRoot,
          record.targetDirectory,
          record.intent.projectId,
        )
      : null
  if (
    currentManifest &&
    (manifest?.introduced !== true ||
      !manifest.registeredFingerprint ||
      currentManifest.fingerprint !== manifest.registeredFingerprint)
  ) {
    throw new Error(
      'Project manifest registration ownership cannot be confirmed; registration was preserved.',
    )
  }

  const recentEntries = await recentWorkspaceEntries(options)
  const currentApplication =
    record.applicationRegistration.beforeFingerprint === null
      ? recentEntryForTarget(recentEntries, record.targetDirectory)
      : null
  const expectedApplication = record.applicationRegistration.registeredFingerprint
  if (
    currentApplication &&
    (record.applicationRegistration.introduced !== true ||
      !expectedApplication ||
      fingerprint(currentApplication) !== expectedApplication)
  ) {
    throw new Error(
      'Recent Workspace registration ownership cannot be confirmed; registration was preserved.',
    )
  }

  if (currentApplication) {
    await options.settingsStore.set(
      'recent_projects',
      recentEntries.filter(
        (entry) =>
          normalizeCreationPath(String(entry.path ?? '')) !==
          normalizeCreationPath(record.targetDirectory),
      ) as DesktopSettingsValue,
    )
  }
  try {
    if (currentManifest) {
      await options.projectManifestService.removeWorkspaceRegistration(
        record.intent.projectRoot,
        manifest?.registeredFingerprint
          ? { ...currentManifest, fingerprint: manifest.registeredFingerprint }
          : currentManifest,
      )
    }
  } catch (error) {
    if (currentApplication) {
      await options.settingsStore
        .set('recent_projects', recentEntries as DesktopSettingsValue)
        .catch(() => undefined)
    }
    throw error
  }
}

export async function isUnambiguouslyComplete(
  options: WorkspaceCreationRegistrationOptions,
  record: CreationJournalRecord,
): Promise<boolean> {
  if (!(await options.isWorkspace(record.targetDirectory))) return false
  if (record.manifestRegistration) {
    const manifest = await options.projectManifestService.inspectWorkspaceRegistration(
      record.intent.projectRoot,
      record.targetDirectory,
      record.intent.projectId,
    )
    if (!manifest) return false
    const expected = record.manifestRegistration.registeredFingerprint
    if (expected && manifest.fingerprint !== expected) return false
    if (!expected && record.manifestRegistration.beforeFingerprint !== null) return false
  }
  const application = await recentWorkspaceEntry(options, record.targetDirectory)
  if (!application) return false
  const expected = record.applicationRegistration.registeredFingerprint
  if (expected && fingerprint(application) !== expected) return false
  return (
    expected !== undefined || record.applicationRegistration.beforeFingerprint === null
  )
}

async function ensureRecentWorkspaceEntry(
  options: WorkspaceCreationRegistrationOptions,
  targetDirectory: string,
): Promise<Record<string, unknown>> {
  const existing = await recentWorkspaceEntry(options, targetDirectory)
  if (existing) return existing
  const entry = {
    designTool: 'backend',
    id: normalizeCreationPath(targetDirectory),
    lastOpened: new Date().toISOString(),
    name: basenameCreationPath(targetDirectory),
    path: normalizeCreationPath(targetDirectory),
  }
  await options.settingsStore.set('recent_projects', [
    entry,
    ...(await recentWorkspaceEntries(options)),
  ] as unknown as DesktopSettingsValue)
  return entry
}

async function recentWorkspaceEntry(
  options: WorkspaceCreationRegistrationOptions,
  targetDirectory: string,
): Promise<Record<string, unknown> | null> {
  return recentEntryForTarget(await recentWorkspaceEntries(options), targetDirectory)
}

async function recentWorkspaceEntries(
  options: WorkspaceCreationRegistrationOptions,
): Promise<Record<string, unknown>[]> {
  const value: unknown = await options.settingsStore.get('recent_projects')
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function recentEntryForTarget(
  entries: Record<string, unknown>[],
  targetDirectory: string,
): Record<string, unknown> | null {
  const target = normalizeCreationPath(targetDirectory)
  const matches = entries.filter(
    (entry) => normalizeCreationPath(String(entry.path ?? '')) === target,
  )
  if (matches.length > 1) throw new Error('Recent Workspace registration is ambiguous.')
  return matches[0] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
