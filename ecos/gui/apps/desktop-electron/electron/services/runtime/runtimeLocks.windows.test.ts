import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const epermDirectoryReadPaths = vi.hoisted(() => new Set<string>())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn((file: unknown, options?: unknown) => {
      const filePath = typeof file === 'string'
        ? file
        : file instanceof URL
          ? file.pathname
          : ''
      if (epermDirectoryReadPaths.has(filePath)) {
        const error = new Error('operation not permitted') as NodeJS.ErrnoException
        error.code = 'EPERM'
        throw error
      }
      return actual.readFile(file as never, options as never)
    }),
  }
})

import {
  readRuntimeLockOwner,
  runtimeLockName,
} from './runtimeLocks'

describe('runtimeLocks Windows directory compatibility', () => {
  it('reads directory lock owners when directory reads report EPERM', async () => {
    const root = path.join(tmpdir(), `ecos-runtime-lock-test-${randomUUID()}`)
    const lockDirectory = path.join(root, `${runtimeLockName('/work/demo')}.lock`)
    try {
      await mkdir(lockDirectory, { recursive: true })
      await writeFile(path.join(lockDirectory, 'owner.json'), JSON.stringify({
        jobId: 'job-1',
        pid: process.pid,
        scope: '/work/demo',
      }))
      epermDirectoryReadPaths.add(lockDirectory)

      await expect(readRuntimeLockOwner(lockDirectory)).resolves.toEqual({
        jobId: 'job-1',
        pid: process.pid,
        scope: '/work/demo',
      })
    } finally {
      epermDirectoryReadPaths.delete(lockDirectory)
      await rm(root, { force: true, recursive: true })
    }
  })
})
