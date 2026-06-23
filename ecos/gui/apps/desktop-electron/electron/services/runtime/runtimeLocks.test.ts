import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  acquireRuntimeLock,
  isProcessAlive,
  isRuntimeScopeActive,
  readRuntimeLockOwner,
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
})
