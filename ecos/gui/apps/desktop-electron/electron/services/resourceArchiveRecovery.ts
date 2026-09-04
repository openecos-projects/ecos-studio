import { createHash, randomUUID } from 'node:crypto'
import { type Dirent } from 'node:fs'
import { access, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { electronLogger } from './logger'

export type ResourceArchiveSha256Verifier = (
  filePath: string,
  expected: string,
  signal?: AbortSignal,
) => Promise<boolean>

export interface ResourceArchiveFileOperations {
  readDirectory: (path: string) => Promise<Dirent[]>
  remove: (path: string) => Promise<void>
  rename: (sourcePath: string, destinationPath: string) => Promise<void>
}

export interface PrepareResourceArchiveOptions {
  expectedSha256: string
  fileOperations?: Partial<ResourceArchiveFileOperations>
  resourceId: string
  resourcesDir: string
  sha256Verifier: ResourceArchiveSha256Verifier
  signal: AbortSignal
  sourceUrl: string
  version: string
}

export interface PreparedResourceArchive {
  completedArchivePath: string
  partialArchivePath: string
}

interface ArchiveRecoveryCandidates {
  currentOperationCandidates: string[]
  legacyOperationCandidates: string[]
  supersededChecksumCandidates: string[]
}

/** Prepares stable download and unique completed paths, recovering interrupted archives. */
export async function prepareResourceArchive({
  expectedSha256,
  fileOperations: fileOperationOverrides,
  resourceId,
  resourcesDir,
  sha256Verifier,
  signal,
  sourceUrl,
  version,
}: PrepareResourceArchiveOptions): Promise<PreparedResourceArchive> {
  throwIfAborted(signal)
  const fileOperations: ResourceArchiveFileOperations = {
    readDirectory: async (path) => await readdir(path, { withFileTypes: true }),
    remove: async (path) => await rm(path, { force: true }),
    rename,
    ...fileOperationOverrides,
  }
  const legacyArchivePath = resourceArchivePath(
    resourcesDir,
    resourceId,
    version,
    sourceUrl,
  )
  const archivePath = resourceArchivePath(resourcesDir, resourceId, version, sourceUrl, {
    sha256: expectedSha256,
  })
  const completedArchivePath = resourceArchivePath(
    resourcesDir,
    resourceId,
    version,
    sourceUrl,
    { operationId: randomUUID(), sha256: expectedSha256 },
  )
  const partialArchivePath = `${archivePath}.part`

  await mkdir(dirname(completedArchivePath), { recursive: true })
  throwIfAborted(signal)
  await recoverPartialArchive({
    archivePath,
    expectedSha256,
    fileOperations,
    legacyArchivePath,
    partialArchivePath,
    sha256Verifier,
    signal,
    sourceUrl,
  })
  return { completedArchivePath, partialArchivePath }
}

export function removeCompletedResourceArchive(path: string, resourceId: string): void {
  void rm(path, { force: true }).catch((error) => {
    electronLogger.warn(
      '[resources] Installed %s but failed to remove completed archive %s: %s',
      resourceId,
      path,
      error instanceof Error ? error.message : String(error),
    )
  })
}

function archiveExtensionFromUrl(sourceUrl: string): string {
  let pathname = sourceUrl
  try {
    pathname = new URL(sourceUrl).pathname
  } catch {
    pathname = sourceUrl.split(/[?#]/, 1)[0]
  }
  const lower = pathname.toLowerCase()
  for (const extension of ['.tar.gz', '.tar.xz', '.tgz', '.txz', '.tar', '.zip']) {
    if (lower.endsWith(extension)) return extension
  }
  return '.archive'
}

function resourceArchivePath(
  resourcesDir: string,
  resourceId: string,
  version: string,
  sourceUrl: string,
  options: { operationId?: string; sha256?: string } = {},
): string {
  const safeId = resourceId.replace(/[^A-Za-z0-9._-]+/g, '-')
  const safeVersion = version.replace(/[^A-Za-z0-9._-]+/g, '-')
  const sourceHash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 12)
  const checksumSuffix = options.sha256
    ? `-${createHash('sha256').update(options.sha256.trim().toLowerCase()).digest('hex').slice(0, 16)}`
    : ''
  const operationSuffix = options.operationId ? `-${options.operationId}` : ''
  return join(
    resourcesDir,
    'downloads',
    `${safeId}-${safeVersion}-${sourceHash}${checksumSuffix}${operationSuffix}${archiveExtensionFromUrl(sourceUrl)}`,
  )
}

interface RecoverPartialArchiveOptions {
  archivePath: string
  expectedSha256: string
  fileOperations: ResourceArchiveFileOperations
  legacyArchivePath: string
  partialArchivePath: string
  sha256Verifier: ResourceArchiveSha256Verifier
  signal: AbortSignal
  sourceUrl: string
}

async function recoverPartialArchive({
  archivePath,
  expectedSha256,
  fileOperations,
  legacyArchivePath,
  partialArchivePath,
  sha256Verifier,
  signal,
  sourceUrl,
}: RecoverPartialArchiveOptions): Promise<void> {
  throwIfAborted(signal)
  const partialExists = await pathExists(partialArchivePath)
  const {
    currentOperationCandidates,
    legacyOperationCandidates,
    supersededChecksumCandidates,
  } = await archiveRecoveryCandidates(
    archivePath,
    legacyArchivePath,
    sourceUrl,
    fileOperations,
  )
  await removeArchiveCandidates(
    supersededChecksumCandidates,
    fileOperations,
    signal,
    'archive from a superseded registry lock',
  )
  const candidates = Array.from(
    new Set([
      archivePath,
      ...currentOperationCandidates,
      `${legacyArchivePath}.part`,
      legacyArchivePath,
      ...legacyOperationCandidates,
    ]),
  )
  if (partialExists) {
    await removeArchiveCandidates(
      candidates,
      fileOperations,
      signal,
      'unused archive recovery candidate',
    )
    return
  }
  for (const candidate of candidates) {
    throwIfAborted(signal)
    try {
      if (!(await pathExists(candidate))) continue
      const verified =
        Boolean(expectedSha256) &&
        (await sha256Verifier(candidate, expectedSha256, signal))
      if (!verified) {
        electronLogger.warn(
          '[resources] Removing archive recovery candidate with a stale registry lock: %s',
          candidate,
        )
        await fileOperations.remove(candidate)
        continue
      }
      await fileOperations.rename(candidate, partialArchivePath)
      await removeArchiveCandidates(
        candidates.filter((otherCandidate) => otherCandidate !== candidate),
        fileOperations,
        signal,
        'unused archive recovery candidate',
      )
      return
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error
      if (isFileNotFoundError(error)) continue
      electronLogger.warn(
        '[resources] Skipping unusable archive recovery candidate %s: %s',
        candidate,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

async function archiveRecoveryCandidates(
  archivePath: string,
  legacyArchivePath: string,
  sourceUrl: string,
  fileOperations: ResourceArchiveFileOperations,
): Promise<ArchiveRecoveryCandidates> {
  const extension = archiveExtensionFromUrl(sourceUrl)
  const archiveDirectory = dirname(archivePath)
  const entries = await fileOperations
    .readDirectory(archiveDirectory)
    .catch((error: unknown) => {
      if (!isFileNotFoundError(error)) {
        electronLogger.warn(
          '[resources] Unable to scan archive recovery candidates in %s: %s',
          archiveDirectory,
          error instanceof Error ? error.message : String(error),
        )
      }
      return []
    })
  const operationCandidates = (resumableArchivePath: string): string[] => {
    const archiveName = basename(resumableArchivePath)
    const stem = archiveName.slice(0, -extension.length)
    const operationArchivePattern = new RegExp(
      `^${escapeRegExp(stem)}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}${escapeRegExp(extension)}$`,
      'i',
    )
    return entries
      .filter((entry) => entry.isFile() && operationArchivePattern.test(entry.name))
      .map((entry) => join(archiveDirectory, entry.name))
      .sort()
  }
  const currentArchiveName = basename(archivePath)
  const currentStem = currentArchiveName.slice(0, -extension.length).toLowerCase()
  const legacyArchiveName = basename(legacyArchivePath)
  const legacyStem = legacyArchiveName.slice(0, -extension.length)
  const checksumScopePattern = new RegExp(
    `^${escapeRegExp(legacyStem)}-([0-9a-f]{16})(?:-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?${escapeRegExp(extension)}(?:\\.part)?$`,
    'i',
  )
  const supersededChecksumCandidates = entries
    .filter((entry) => {
      if (!entry.isFile()) return false
      const match = checksumScopePattern.exec(entry.name)
      if (!match) return false
      return `${legacyStem}-${match[1]}`.toLowerCase() !== currentStem
    })
    .map((entry) => join(archiveDirectory, entry.name))
    .sort()
  return {
    currentOperationCandidates: operationCandidates(archivePath),
    legacyOperationCandidates: operationCandidates(legacyArchivePath),
    supersededChecksumCandidates,
  }
}

async function removeArchiveCandidates(
  candidates: string[],
  fileOperations: ResourceArchiveFileOperations,
  signal: AbortSignal,
  description: string,
): Promise<void> {
  for (const candidate of candidates) {
    throwIfAborted(signal)
    try {
      await fileOperations.remove(candidate)
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error
      if (isFileNotFoundError(error)) continue
      electronLogger.warn(
        '[resources] Unable to remove %s %s: %s',
        description,
        candidate,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new DOMException('The operation was aborted.', 'AbortError')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
