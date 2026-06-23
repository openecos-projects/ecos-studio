import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
    const raw = await readFile(path.join(lockDirectory, 'owner.json'), 'utf8')
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

export async function acquireRuntimeLock(
  rootDirectory: string,
  scope: string,
  jobId: string,
): Promise<RuntimeLockHandle | null> {
  await mkdir(rootDirectory, { recursive: true })
  const lockDirectory = path.join(rootDirectory, `${runtimeLockName(scope)}.lock`)

  try {
    await mkdir(lockDirectory)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') throw error

    const owner = await readRuntimeLockOwner(lockDirectory)
    if (!owner || owner.scope !== scope || !isProcessAlive(owner.pid)) {
      await rm(lockDirectory, { force: true, recursive: true })
      return acquireRuntimeLock(rootDirectory, scope, jobId)
    }
    return null
  }

  await writeFile(
    path.join(lockDirectory, 'owner.json'),
    JSON.stringify({
      jobId,
      pid: process.pid,
      scope,
    }, null, 2),
  )

  return {
    directory: lockDirectory,
    release: async () => {
      await rm(lockDirectory, { force: true, recursive: true })
    },
  }
}

export async function isRuntimeScopeActive(
  rootDirectory: string,
  scope: string,
): Promise<boolean> {
  const lockDirectory = path.join(rootDirectory, `${runtimeLockName(scope)}.lock`)
  const owner = await readRuntimeLockOwner(lockDirectory)
  if (!owner || owner.scope !== scope || !isProcessAlive(owner.pid)) {
    await rm(lockDirectory, { force: true, recursive: true })
    return false
  }
  return true
}
