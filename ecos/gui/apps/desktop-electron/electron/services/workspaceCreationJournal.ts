import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  EccBackgroundWorkspaceCreation,
  EccWorkspaceCreateRequest,
  EccWorkspaceCreationStage,
} from '@ecos-studio/shared'
import { isPathWithinRoot } from './pathScope'
import {
  authorizeCreationRecord,
  creationTargetExists,
  nodeErrorCode,
  requireActiveCreationOwner,
  requireCreationRecovery,
  workspaceCreationIdentityMatches,
  type CreationPathAuthorizer,
} from './workspaceCreationJournalAuthorization'
import {
  boundedIssue,
  isCreationJournalRecord,
  monotonicCreationStage,
  normalizeCreationPath,
  projectCreationRecord,
  sanitizedRecord,
  type CreationJournalRecord,
} from './workspaceCreationJournalRecord'
import {
  captureRegistrationOwnership,
  confirmApplicationRegistration,
  confirmManifestRegistration,
  isUnambiguouslyComplete,
  removeOwnedRegistrations,
  type WorkspaceCreationRegistrationOptions,
} from './workspaceCreationRegistrations'

interface InvalidJournal {
  entry: EccBackgroundWorkspaceCreation
  path: string
}

export interface WorkspaceCreationJournalOptions
  extends WorkspaceCreationRegistrationOptions, CreationPathAuthorizer {
  directory: string
  inspectWorkspaceIdentity(
    targetDirectory: string,
  ): Promise<{ workspaceId?: string; workspaceRevision?: number }>
}

export class WorkspaceCreationJournal {
  private readonly records = new Map<string, CreationJournalRecord>()
  private readonly invalid = new Map<string, InvalidJournal>()
  private readonly recovered: EccBackgroundWorkspaceCreation[] = []
  private readonly listeners = new Set<(generation: number) => void>()
  private readonly actions = new Map<string, Promise<unknown>>()
  private initialized = false
  private initializing: Promise<void> | null = null
  private projectionGeneration = 0

  constructor(private readonly options: WorkspaceCreationJournalOptions) {}

  get generation(): number {
    return this.projectionGeneration
  }

  onInvalidated(listener: (generation: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    this.initializing ??= this.load()
      .then(() => {
        this.initialized = true
      })
      .finally(() => {
        this.initializing = null
      })
    return this.initializing
  }

  async begin(
    ownerWindowId: number,
    request: EccWorkspaceCreateRequest,
  ): Promise<CreationJournalRecord> {
    await this.initialize()
    if (
      [...this.records.values()].some(
        (record) =>
          record.ownerWindowId === ownerWindowId &&
          record.commandId === request.commandId,
      )
    ) {
      throw new Error('Workspace creation command is already journaled.')
    }
    if (
      !isAbsolute(request.targetDirectory) ||
      (request.projectRoot !== undefined && !isAbsolute(request.projectRoot))
    ) {
      throw new Error('Workspace creation paths must be absolute.')
    }
    const requestedTarget = resolve(request.targetDirectory)
    const requestedRoot = resolve(request.projectRoot ?? dirname(requestedTarget))
    const { projectRoot, targetDirectory } = await this.options.canonicalizePaths(
      requestedRoot,
      requestedTarget,
    )
    if (
      !isAbsolute(targetDirectory) ||
      !isAbsolute(projectRoot) ||
      !isPathWithinRoot(targetDirectory, projectRoot)
    ) {
      throw new Error('Workspace creation target is outside the Project root.')
    }
    const now = Date.now()
    const registrations = await captureRegistrationOwnership(
      this.options,
      projectRoot,
      targetDirectory,
      request.projectId,
    )
    const record: CreationJournalRecord = {
      ...registrations,
      commandId: request.commandId,
      createdAt: now,
      creationId: randomUUID(),
      intent: {
        ...(request.projectId ? { projectId: request.projectId } : {}),
        projectRoot,
        workspaceBindings: sanitizedRecord(request.workspaceBindings),
        workspaceSpec: sanitizedRecord(request.workspaceSpec),
      },
      ownerWindowId,
      stage: 'intent-recorded',
      status: 'active',
      targetDirectory,
      targetExistedBefore: await creationTargetExists(targetDirectory),
      updatedAt: now,
      version: 1,
    }
    await this.write(record)
    this.records.set(record.creationId, record)
    this.invalidate()
    return structuredClone(record)
  }

  complete(creationId: string, ownerWindowId: number): Promise<void> {
    return this.serialize(creationId, async () => {
      const record = this.requireRecord(creationId)
      requireActiveCreationOwner(record, ownerWindowId)
      await authorizeCreationRecord(this.options, record)
      const withManifest = await this.advance(
        await confirmManifestRegistration(this.options, record, false),
        'manifest-registered',
      )
      const withApplication = await this.advance(
        await confirmApplicationRegistration(this.options, withManifest, false),
        'application-registered',
      )
      await this.finish(withApplication, false)
    })
  }

  markWorkspaceCreated(
    creationId: string,
    result: { workspaceId?: string; workspaceRevision?: number },
    ownerWindowId: number,
  ): Promise<void> {
    return this.serialize(creationId, async () => {
      const record = this.requireRecord(creationId)
      requireActiveCreationOwner(record, ownerWindowId)
      const updated: CreationJournalRecord = {
        ...record,
        stage: monotonicCreationStage(record.stage, 'workspace-created'),
        updatedAt: Date.now(),
        ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}),
        ...(typeof result.workspaceRevision === 'number'
          ? { workspaceRevision: result.workspaceRevision }
          : {}),
      }
      await this.write(updated)
      this.records.set(creationId, updated)
      this.invalidate()
    })
  }

  registerWorkspace(creationId: string, ownerWindowId: number): Promise<void> {
    return this.serialize(creationId, async () => {
      const record = this.requireRecord(creationId)
      requireActiveCreationOwner(record, ownerWindowId)
      await authorizeCreationRecord(this.options, record)
      await this.advance(
        await confirmManifestRegistration(this.options, record, true),
        'manifest-registered',
      )
    })
  }

  markUnfinished(
    creationId: string,
    issue: string,
    ownerWindowId: number,
  ): Promise<void> {
    return this.serialize(creationId, async () => {
      const record = this.requireRecord(creationId)
      requireActiveCreationOwner(record, ownerWindowId)
      await this.updateUnfinished(record, issue)
    })
  }

  async markActiveUnfinished(ownerWindowIds?: ReadonlySet<number>): Promise<void> {
    await this.initialize()
    await Promise.all(
      [...this.records.values()]
        .filter(
          (record) =>
            record.status === 'active' &&
            (!ownerWindowIds || ownerWindowIds.has(record.ownerWindowId)),
        )
        .map((record) =>
          this.enqueue(record.creationId, async () => {
            const current = this.records.get(record.creationId)
            if (!current || current.status !== 'active') return
            await this.updateUnfinished(current, 'Application exited during creation.')
          }),
        ),
    )
  }

  async entriesForWindow(windowId: number): Promise<EccBackgroundWorkspaceCreation[]> {
    await this.initialize()
    return [
      ...[...this.records.values()]
        .filter(
          (record) => record.status === 'unfinished' || record.ownerWindowId === windowId,
        )
        .map(projectCreationRecord),
      ...[...this.invalid.values()].map(({ entry }) => ({ ...entry })),
      ...this.recovered.map((entry) => ({ ...entry })),
    ]
  }

  async allEntries(): Promise<EccBackgroundWorkspaceCreation[]> {
    await this.initialize()
    return [
      ...[...this.records.values()].map(projectCreationRecord),
      ...[...this.invalid.values()].map(({ entry }) => ({ ...entry })),
      ...this.recovered.map((entry) => ({ ...entry })),
    ]
  }

  async allowsRegistration(
    windowId: number,
    projectRoot: string,
    targetDirectory: string,
  ): Promise<boolean> {
    await this.initialize()
    const project = normalizeCreationPath(projectRoot)
    const target = normalizeCreationPath(targetDirectory)
    return [...this.records.values()].some(
      (record) =>
        record.status === 'active' &&
        record.ownerWindowId === windowId &&
        normalizeCreationPath(record.intent.projectRoot) === project &&
        normalizeCreationPath(record.targetDirectory) === target,
    )
  }

  continueInitialization(
    creationId: string,
    _ownerWindowId: number,
  ): Promise<{ recovered: boolean; issue?: string }> {
    return this.serialize(creationId, async () => {
      const record = this.requireRecord(creationId)
      requireCreationRecovery(record)
      await authorizeCreationRecord(this.options, record)
      if (!(await this.options.isWorkspace(record.targetDirectory))) {
        const issue =
          'The target is not a complete ECOS Workspace. Files were left unchanged.'
        await this.updateUnfinished(record, issue)
        return { recovered: false, issue }
      }
      const identity = await this.options.inspectWorkspaceIdentity(record.targetDirectory)
      if (!workspaceCreationIdentityMatches(record, identity)) {
        const issue =
          'The Workspace identity or Revision does not match this creation record. Files were left unchanged.'
        await this.updateUnfinished(record, issue)
        return { recovered: false, issue }
      }
      const withManifest = await this.advance(
        await confirmManifestRegistration(this.options, record, true),
        'manifest-registered',
      )
      const withApplication = await this.advance(
        await confirmApplicationRegistration(this.options, withManifest, true),
        'application-registered',
      )
      await this.finish(withApplication, true)
      return { recovered: true }
    })
  }

  abandon(creationId: string, _ownerWindowId: number): Promise<{ abandoned: boolean }> {
    return this.serialize(creationId, async () => {
      const record = this.records.get(creationId)
      if (record) {
        requireCreationRecovery(record)
        await authorizeCreationRecord(this.options, record)
        await removeOwnedRegistrations(this.options, record)
        await rm(this.pathFor(creationId), { force: true })
        this.records.delete(creationId)
      } else {
        const invalid = this.invalid.get(creationId)
        if (!invalid) throw new Error('Workspace creation journal was not found.')
        throw new Error(
          'Invalid creation journals require manual quarantine and were left unchanged.',
        )
      }
      this.invalidate()
      return { abandoned: true }
    })
  }

  private async load(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.options.directory)
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') return
      throw error
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const path = join(this.options.directory, name)
      try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (!isCreationJournalRecord(parsed)) throw new Error('Invalid schema.')
        await authorizeCreationRecord(this.options, parsed)
        if (
          normalizeCreationPath(parsed.intent.projectRoot) !==
            normalizeCreationPath(parsed.targetDirectory) &&
          !parsed.manifestRegistration
        ) {
          throw new Error('Managed Workspace registration evidence is missing.')
        }
        if (parsed.stage === 'completed') {
          await rm(path, { force: true })
          this.recordRecovered(parsed)
          continue
        }
        const record =
          parsed.status === 'active'
            ? {
                ...parsed,
                issue: 'Application exited during creation.',
                status: 'unfinished' as const,
                updatedAt: Date.now(),
              }
            : parsed
        if (record !== parsed) await this.write(record)
        try {
          if (
            (await isUnambiguouslyComplete(this.options, record)) &&
            workspaceCreationIdentityMatches(
              record,
              await this.options.inspectWorkspaceIdentity(record.targetDirectory),
            )
          ) {
            await rm(path, { force: true })
            this.recordRecovered(record)
            continue
          }
          this.records.set(record.creationId, record)
        } catch (error) {
          const unfinished = {
            ...record,
            issue: boundedIssue(error instanceof Error ? error.message : String(error)),
            status: 'unfinished' as const,
            updatedAt: Date.now(),
          }
          await this.write(unfinished)
          this.records.set(unfinished.creationId, unfinished)
        }
      } catch (error) {
        const creationId = name.slice(0, -5)
        this.invalid.set(creationId, {
          entry: {
            creationId,
            issue: boundedIssue(error instanceof Error ? error.message : String(error)),
            status: 'invalid',
            updatedAt: Date.now(),
          },
          path,
        })
      }
    }
    if (this.records.size || this.invalid.size) this.invalidate()
  }

  private async write(record: CreationJournalRecord): Promise<void> {
    await mkdir(this.options.directory, { recursive: true })
    const path = this.pathFor(record.creationId)
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, JSON.stringify(record), 'utf8')
      await rename(temporaryPath, path)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private pathFor(creationId: string): string {
    return join(this.options.directory, `${creationId}.json`)
  }

  private requireRecord(creationId: string): CreationJournalRecord {
    const record = this.records.get(creationId)
    if (!record) throw new Error('Workspace creation journal was not found.')
    return record
  }

  private async advance(
    record: CreationJournalRecord,
    stage: EccWorkspaceCreationStage,
  ): Promise<CreationJournalRecord> {
    const nextStage = monotonicCreationStage(record.stage, stage)
    if (nextStage === record.stage) return record
    const updated = { ...record, stage: nextStage, updatedAt: Date.now() }
    await this.write(updated)
    this.records.set(record.creationId, updated)
    this.invalidate()
    return updated
  }

  private async finish(record: CreationJournalRecord, recovered: boolean): Promise<void> {
    const completed = await this.advance(record, 'completed')
    await rm(this.pathFor(record.creationId), { force: true })
    this.records.delete(record.creationId)
    if (recovered) this.recordRecovered(completed)
    this.invalidate()
  }

  private recordRecovered(record: CreationJournalRecord): void {
    this.recovered.push({
      creationId: record.creationId,
      issue: 'Workspace creation was recovered and registration is complete.',
      ...(record.intent.projectId ? { projectId: record.intent.projectId } : {}),
      projectRoot: record.intent.projectRoot,
      stage: 'completed',
      status: 'recovered',
      targetDirectory: record.targetDirectory,
      updatedAt: Date.now(),
    })
    if (this.recovered.length > 16) this.recovered.splice(0, this.recovered.length - 16)
  }

  private async updateUnfinished(
    record: CreationJournalRecord,
    issue: string,
  ): Promise<void> {
    const updated = {
      ...record,
      issue: boundedIssue(issue),
      status: 'unfinished' as const,
      updatedAt: Date.now(),
    }
    await this.write(updated)
    this.records.set(record.creationId, updated)
    this.invalidate()
  }

  private async serialize<T>(creationId: string, action: () => Promise<T>): Promise<T> {
    await this.initialize()
    return await this.enqueue(creationId, action)
  }

  private async enqueue<T>(creationId: string, action: () => Promise<T>): Promise<T> {
    const key = this.records.get(creationId)?.intent.projectRoot ?? creationId
    const previous = this.actions.get(key) ?? Promise.resolve()
    const next = previous.then(action, action)
    this.actions.set(key, next)
    void next.then(
      () => {
        if (this.actions.get(key) === next) this.actions.delete(key)
      },
      () => {
        if (this.actions.get(key) === next) this.actions.delete(key)
      },
    )
    return await next
  }

  private invalidate(): void {
    this.projectionGeneration += 1
    for (const listener of this.listeners) listener(this.projectionGeneration)
  }
}
