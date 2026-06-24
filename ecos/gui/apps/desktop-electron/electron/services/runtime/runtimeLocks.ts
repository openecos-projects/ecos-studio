import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'

export interface RuntimeLockHandle {
  directory: string
  release(): Promise<void>
}

export interface RuntimeLockOwner {
  jobId: string
  pid: number
  scope: string
}

export const runtimeLockInitializationGraceMs = 5_000
const runtimeLockReclaimRetryAttempts = 50
const runtimeLockReclaimRetryDelayMs = 10

export function runtimeLockName(scope: string): string {
  return createHash('sha256').update(scope).digest('hex').slice(0, 24)
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EPERM'
  }
}

export async function readRuntimeLockOwner(lockDirectory: string): Promise<RuntimeLockOwner | null> {
  try {
    const raw = await readLockOwnerText(lockDirectory)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RuntimeLockOwner>
    if (
      typeof parsed.jobId === 'string'
      && typeof parsed.pid === 'number'
      && typeof parsed.scope === 'string'
    ) {
      return {
        jobId: parsed.jobId,
        pid: parsed.pid,
        scope: parsed.scope,
      }
    }
  } catch {
    return null
  }
  return null
}

async function readLockOwnerText(lockPath: string): Promise<string | null> {
  try {
    return await readFile(lockPath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EISDIR') return null
  }

  try {
    return await readFile(path.join(lockPath, 'owner.json'), 'utf8')
  } catch {
    return null
  }
}

export async function acquireRuntimeLock(
  rootDirectory: string,
  scope: string,
  jobId: string,
): Promise<RuntimeLockHandle | null> {
  return acquireRuntimeLockWithReclaimRetry(
    rootDirectory,
    scope,
    jobId,
    runtimeLockReclaimRetryAttempts,
  )
}

async function acquireRuntimeLockWithReclaimRetry(
  rootDirectory: string,
  scope: string,
  jobId: string,
  remainingReclaimRetries: number,
): Promise<RuntimeLockHandle | null> {
  await mkdir(rootDirectory, { recursive: true })
  const lockPath = path.join(rootDirectory, `${runtimeLockName(scope)}.lock`)
  const owner: RuntimeLockOwner = {
    jobId,
    pid: process.pid,
    scope,
  }
  const lock = await acquireOwnerFileLock(lockPath, owner)
  if (lock) return lock

  const active = await isRuntimeLockPathActive(lockPath, scope)
  if (active) return null

  const reclaimLock = await acquireRuntimeReclaimLock(rootDirectory, scope, jobId)
  if (!reclaimLock) {
    if (await isRuntimeLockPathActive(lockPath, scope)) return null
    if (remainingReclaimRetries <= 0) return null
    await waitForRuntimeLockReclaimRetry()
    return acquireRuntimeLockWithReclaimRetry(
      rootDirectory,
      scope,
      jobId,
      remainingReclaimRetries - 1,
    )
  }
  try {
    if (await isRuntimeLockPathActive(lockPath, scope)) {
      return null
    }
    await rm(lockPath, { force: true, recursive: true })
  } finally {
    await reclaimLock.release()
  }
  return acquireRuntimeLockWithReclaimRetry(
    rootDirectory,
    scope,
    jobId,
    runtimeLockReclaimRetryAttempts,
  )
}

async function acquireRuntimeReclaimLock(
  rootDirectory: string,
  scope: string,
  jobId: string,
): Promise<RuntimeLockHandle | null> {
  await mkdir(rootDirectory, { recursive: true })
  const reclaimScope = `${scope}:reclaim`
  const reclaimPath = path.join(rootDirectory, `${runtimeLockName(reclaimScope)}.reclaim.lock`)
  const owner: RuntimeLockOwner = {
    jobId: `${jobId}:reclaim`,
    pid: process.pid,
    scope: reclaimScope,
  }
  const lock = await acquireOwnerFileLock(reclaimPath, owner)
  if (lock) return lock

  if (await isRuntimeLockPathActive(reclaimPath, reclaimScope)) {
    return null
  }

  await rm(reclaimPath, { force: true, recursive: true })
  return acquireRuntimeReclaimLock(rootDirectory, scope, jobId)
}

async function acquireOwnerFileLock(
  lockPath: string,
  owner: RuntimeLockOwner,
): Promise<RuntimeLockHandle | null> {
  let lockFile: FileHandle

  try {
    lockFile = await open(lockPath, 'wx')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'EISDIR') return null
    throw error
  }

  let removeFailedLock = false
  try {
    await lockFile.writeFile(JSON.stringify(owner, null, 2))
    const currentOwner = await readRuntimeLockOwner(lockPath)
    if (!isSameRuntimeLockOwner(currentOwner, owner)) {
      return null
    }
  } catch (error) {
    removeFailedLock = await isSameFile(lockPath, lockFile)
    throw error
  } finally {
    await lockFile.close()
    if (removeFailedLock) {
      await rm(lockPath, { force: true, recursive: true })
    }
  }

  return {
    directory: lockPath,
    release: async () => {
      const currentOwner = await readRuntimeLockOwner(lockPath)
      if (isSameRuntimeLockOwner(currentOwner, owner)) {
        await rm(lockPath, { force: true, recursive: true })
      }
    },
  }
}

export async function isRuntimeScopeActive(
  rootDirectory: string,
  scope: string,
): Promise<boolean> {
  const lockPath = path.join(rootDirectory, `${runtimeLockName(scope)}.lock`)
  const active = await isRuntimeLockPathActive(lockPath, scope)
  if (!active) {
    const reclaimLock = await acquireRuntimeReclaimLock(rootDirectory, scope, `observer-${process.pid}`)
    if (!reclaimLock) {
      return isRuntimeLockPathActive(lockPath, scope)
    }
    try {
      if (await isRuntimeLockPathActive(lockPath, scope)) {
        return true
      }
      await rm(lockPath, { force: true, recursive: true })
    } finally {
      await reclaimLock.release()
    }
  }
  return active
}

async function isRuntimeLockPathActive(
  lockPath: string,
  scope: string,
): Promise<boolean> {
  const owner = await readRuntimeLockOwner(lockPath)
  if (!owner) {
    try {
      const stats = await stat(lockPath)
      return Date.now() - stats.mtimeMs < runtimeLockInitializationGraceMs
    } catch {
      return false
    }
  }
  if (owner && owner.scope === scope && !isProcessAlive(owner.pid)) {
    return false
  }
  return true
}

function isSameRuntimeLockOwner(
  actual: RuntimeLockOwner | null,
  expected: RuntimeLockOwner,
): boolean {
  return actual?.jobId === expected.jobId
    && actual.pid === expected.pid
    && actual.scope === expected.scope
}

async function isSameFile(lockPath: string, lockFile: FileHandle): Promise<boolean> {
  try {
    const [pathStats, fileStats] = await Promise.all([
      stat(lockPath),
      lockFile.stat(),
    ])
    return isSameStatsFile(pathStats, fileStats)
  } catch {
    return false
  }
}

function isSameStatsFile(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino
}

async function waitForRuntimeLockReclaimRetry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, runtimeLockReclaimRetryDelayMs))
}
