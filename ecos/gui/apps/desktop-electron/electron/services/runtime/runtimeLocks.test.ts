import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  acquireRuntimeLock,
  isProcessAlive,
  isRuntimeScopeActive,
  readRuntimeLockOwner,
  runtimeLockInitializationGraceMs,
  runtimeLockName,
} from './runtimeLocks'

describe('runtimeLocks', () => {
  it('uses stable filesystem-safe lock names', () => {
    expect(runtimeLockName('/work/demo')).toMatch(/^[a-f0-9]{24}$/)
    expect(runtimeLockName('/work/demo')).toBe(runtimeLockName('/work/demo'))
    expect(runtimeLockName('/work/other')).not.toBe(runtimeLockName('/work/demo'))
  })

  it('tracks active scopes through lock acquisition and release', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    try {
      const first = await acquireRuntimeLock(root, '/work/demo', 'job-1')
      expect(first).not.toBeNull()
      await expect(isRuntimeScopeActive(root, '/work/demo')).resolves.toBe(true)

      await expect(acquireRuntimeLock(root, '/work/demo', 'job-2')).resolves.toBeNull()

      await first?.release()
      await expect(isRuntimeScopeActive(root, '/work/demo')).resolves.toBe(false)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('creates directory-format locks with owner files for existing clients', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      const lock = await acquireRuntimeLock(root, '/work/demo', 'job-1')
      expect(lock).not.toBeNull()

      await expect(stat(lockDirectory).then((stats) => stats.isDirectory())).resolves.toBe(true)
      await expect(readFile(path.join(lockDirectory, 'owner.json'), 'utf8')).resolves.toContain(
        '"jobId": "job-1"',
      )

      await lock?.release()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('reads valid lock owners and ignores malformed owner files', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      await writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'job-1',
        pid: process.pid,
        scope: '/work/demo',
      }))
      await expect(readRuntimeLockOwner(lockDirectory)).resolves.toEqual({
        jobId: 'job-1',
        pid: process.pid,
        scope: '/work/demo',
      })

      await writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'job-1',
      }))
      await expect(readRuntimeLockOwner(lockDirectory)).resolves.toBeNull()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('cleans stale lock owners before acquiring a scope', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      await writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'stale-job',
        pid: -1,
        scope: '/work/demo',
      }))

      expect(isProcessAlive(-1)).toBe(false)
      await expect(isRuntimeScopeActive(root, '/work/demo')).resolves.toBe(false)

      const lock = await acquireRuntimeLock(root, '/work/demo', 'job-1')
      expect(lock).not.toBeNull()
      await lock?.release()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('allows only one concurrent stale lock reclaimer to acquire the scope', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      await writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'stale-job',
        pid: -1,
        scope: '/work/demo',
      }))

      const attempts = await Promise.all(
        Array.from({ length: 8 }, (_value, index) =>
          acquireRuntimeLock(root, '/work/demo', `job-${index}`),
        ),
      )
      const locks = attempts.filter((lock): lock is NonNullable<typeof lock> => lock !== null)

      expect(locks).toHaveLength(1)
      await expect(isRuntimeScopeActive(root, '/work/demo')).resolves.toBe(true)
      await locks[0]?.release()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('retries after clearing a stale reclaim lock', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    const reclaimLock = path.join(root, `${runtimeLockName('/work/demo:reclaim')}.reclaim.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      await writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'stale-job',
        pid: -1,
        scope: '/work/demo',
      }))
      await writeFile(reclaimLock, JSON.stringify({
        jobId: 'stale-reclaimer:reclaim',
        pid: -1,
        scope: '/work/demo:reclaim',
      }))

      const lock = await acquireRuntimeLock(root, '/work/demo', 'job-1')

      expect(lock).not.toBeNull()
      await lock?.release()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('waits for observer reclaim contention before reporting lock acquisition blocked', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    const reclaimLock = path.join(root, `${runtimeLockName('/work/demo:reclaim')}.reclaim.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      await writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'stale-job',
        pid: -1,
        scope: '/work/demo',
      }))
      await writeFile(reclaimLock, JSON.stringify({
        jobId: `observer-${process.pid}:reclaim`,
        pid: process.pid,
        scope: '/work/demo:reclaim',
      }))
      const observerRelease = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          rm(reclaimLock, { force: true, recursive: true }).then(resolve, reject)
        }, 5)
      })

      const lock = await acquireRuntimeLock(root, '/work/demo', 'job-1')
      await observerRelease

      expect(lock).not.toBeNull()
      await lock?.release()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('does not delete locks that are still being initialized', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })

      await expect(acquireRuntimeLock(root, '/work/demo', 'job-1')).resolves.toBeNull()
      await expect(isRuntimeScopeActive(root, '/work/demo')).resolves.toBe(true)
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('does not create reclaim locks when checking a missing scope', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    try {
      await expect(isRuntimeScopeActive(root, '/work/demo')).resolves.toBe(false)
      await expect(stat(root)).rejects.toThrow()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('reclaims ownerless locks after initialization stalls', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      const staleTime = new Date(Date.now() - runtimeLockInitializationGraceMs - 1_000)
      await utimes(lockDirectory, staleTime, staleTime)

      await expect(isRuntimeScopeActive(root, '/work/demo')).resolves.toBe(false)
      const lock = await acquireRuntimeLock(root, '/work/demo', 'job-1')
      expect(lock).not.toBeNull()
      await lock?.release()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('prevents reclaimed directory initializers from overwriting the new owner', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      const staleTime = new Date(Date.now() - runtimeLockInitializationGraceMs - 1_000)
      await utimes(lockDirectory, staleTime, staleTime)

      const lock = await acquireRuntimeLock(root, '/work/demo', 'job-1')
      expect(lock).not.toBeNull()

      await expect(writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'stalled-job',
        pid: process.pid,
        scope: '/work/demo',
      }))).rejects.toThrow()
      await expect(readRuntimeLockOwner(lockDirectory)).resolves.toMatchObject({
        jobId: 'job-1',
      })
      await lock?.release()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('does not remove a replacement lock when a stalled initializer cleanup resumes', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const scope = '/work/demo'
    const lockDirectory = path.join(root, `${runtimeLockName(scope)}.lock`)
    const ownerPath = path.join(lockDirectory, 'owner.json')
    const replacementOwner = {
      jobId: 'replacement-job',
      pid: process.pid,
      scope,
    }

    try {
      let simulatedRace = false
      vi.resetModules()
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return {
          ...actual,
          writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
            const [target] = args
            if (target === ownerPath && !simulatedRace) {
              simulatedRace = true
              await actual.rm(lockDirectory, { force: true, recursive: true })
              await actual.mkdir(lockDirectory, { recursive: true })
              await actual.writeFile(ownerPath, JSON.stringify(replacementOwner), { mode: 0o444 })
              await actual.chmod(ownerPath, 0o444)
              const error = new Error('permission denied') as NodeJS.ErrnoException
              error.code = 'EACCES'
              throw error
            }
            return actual.writeFile(...args)
          }),
        }
      })
      const locks = await import('./runtimeLocks')

      await expect(locks.acquireRuntimeLock(root, scope, 'stalled-job')).resolves.toBeNull()
      await expect(locks.readRuntimeLockOwner(lockDirectory)).resolves.toEqual(replacementOwner)
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      await rm(root, { force: true, recursive: true })
    }
  })

  it('does not replace an owner that races into a new lock directory', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const scope = '/work/demo'
    const lockDirectory = path.join(root, `${runtimeLockName(scope)}.lock`)
    const ownerPath = path.join(lockDirectory, 'owner.json')

    try {
      await mkdir(lockDirectory, { recursive: true })
      const staleTime = new Date(Date.now() - runtimeLockInitializationGraceMs - 1_000)
      await utimes(lockDirectory, staleTime, staleTime)

      let simulatedRace = false
      vi.resetModules()
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return {
          ...actual,
          writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
            const [target] = args
            if (target === ownerPath && !simulatedRace) {
              simulatedRace = true
              await actual.writeFile(ownerPath, JSON.stringify({
                jobId: 'stalled-job',
                pid: process.pid,
                scope,
              }), { flag: 'wx', mode: 0o444 })
              await actual.chmod(ownerPath, 0o444)
            }
            return actual.writeFile(...args)
          }),
        }
      })
      const locks = await import('./runtimeLocks')

      const lock = await locks.acquireRuntimeLock(root, scope, 'replacement-job')

      expect(lock).toBeNull()
      await expect(locks.readRuntimeLockOwner(lockDirectory)).resolves.toMatchObject({
        jobId: 'stalled-job',
      })
      await lock?.release()
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      await rm(root, { force: true, recursive: true })
    }
  })

  it('does not trust a replacement directory after creating a lock directory', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const scope = '/work/demo'
    const lockDirectory = path.join(root, `${runtimeLockName(scope)}.lock`)
    const ownerPath = path.join(lockDirectory, 'owner.json')
    const replacementOwner = {
      jobId: 'replacement-job',
      pid: process.pid,
      scope,
    }

    try {
      let simulatedRace = false
      vi.resetModules()
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return {
          ...actual,
          mkdir: vi.fn(async (...args: Parameters<typeof actual.mkdir>) => {
            const [target] = args
            const result = await actual.mkdir(...args)
            if (target === lockDirectory && !simulatedRace) {
              simulatedRace = true
              await actual.rm(lockDirectory, { force: true, recursive: true })
              await actual.mkdir(lockDirectory, { recursive: true })
              await actual.writeFile(ownerPath, JSON.stringify(replacementOwner), { mode: 0o444 })
              await actual.chmod(ownerPath, 0o444)
            }
            return result
          }),
        }
      })
      const locks = await import('./runtimeLocks')

      await expect(locks.acquireRuntimeLock(root, scope, 'stalled-job')).resolves.toBeNull()
      await expect(locks.readRuntimeLockOwner(lockDirectory)).resolves.toEqual(replacementOwner)
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      await rm(root, { force: true, recursive: true })
    }
  })

  it('surfaces lock directory creation permission failures', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const scope = '/work/demo'
    const lockDirectory = path.join(root, `${runtimeLockName(scope)}.lock`)
    let lockDirectoryAttempts = 0

    try {
      vi.resetModules()
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return {
          ...actual,
          mkdir: vi.fn(async (...args: Parameters<typeof actual.mkdir>) => {
            const [target] = args
            if (target === lockDirectory || String(target).endsWith('.reclaim.lock')) {
              lockDirectoryAttempts += 1
              const error = new Error(
                lockDirectoryAttempts === 1
                  ? 'permission denied'
                  : 'recurred after permission failure',
              ) as NodeJS.ErrnoException
              error.code = lockDirectoryAttempts === 1 ? 'EACCES' : 'ELOOP'
              throw error
            }
            return actual.mkdir(...args)
          }),
        }
      })
      const locks = await import('./runtimeLocks')

      await expect(locks.acquireRuntimeLock(root, scope, 'job-1')).rejects.toThrow(
        'permission denied',
      )
      expect(lockDirectoryAttempts).toBe(1)
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      await rm(root, { force: true, recursive: true })
    }
  })

  it('surfaces owner-file permission failures in the created lock directory', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const scope = '/work/demo'
    const lockDirectory = path.join(root, `${runtimeLockName(scope)}.lock`)
    const ownerPath = path.join(lockDirectory, 'owner.json')
    let ownerWriteAttempts = 0

    try {
      vi.resetModules()
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return {
          ...actual,
          writeFile: vi.fn(async (...args: Parameters<typeof actual.writeFile>) => {
            const [target] = args
            if (target === ownerPath) {
              ownerWriteAttempts += 1
              const error = new Error(
                ownerWriteAttempts === 1
                  ? 'permission denied'
                  : 'permission failure retried',
              ) as NodeJS.ErrnoException
              error.code = ownerWriteAttempts === 1 ? 'EACCES' : 'ELOOP'
              throw error
            }
            return actual.writeFile(...args)
          }),
        }
      })
      const locks = await import('./runtimeLocks')

      await expect(locks.acquireRuntimeLock(root, scope, 'job-1')).rejects.toThrow(
        'permission denied',
      )
      expect(ownerWriteAttempts).toBe(1)
      await expect(stat(lockDirectory)).rejects.toThrow()
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
      await rm(root, { force: true, recursive: true })
    }
  })
})
