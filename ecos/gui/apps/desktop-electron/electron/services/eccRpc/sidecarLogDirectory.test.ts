import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveEccSidecarLogDirectory } from './sidecarLogDirectory'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      rmSync(dir, { force: true, recursive: true })
    }
  }
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ecc-sidecar-log-'))
  tempDirs.push(dir)
  return dir
}

describe('resolveEccSidecarLogDirectory', () => {
  it('returns null for control runtime / missing directory', () => {
    expect(resolveEccSidecarLogDirectory(null)).toBeNull()
    expect(resolveEccSidecarLogDirectory(undefined)).toBeNull()
    expect(resolveEccSidecarLogDirectory('')).toBeNull()
  })

  it('returns null before workspace create materializes home/', () => {
    const directory = makeTempDir()
    mkdirSync(join(directory, 'log'), { recursive: true })
    writeFileSync(join(directory, 'log', 'ecc-rpc-runtime.log'), '')

    expect(resolveEccSidecarLogDirectory(directory)).toBeNull()
  })

  it('returns <directory>/log once home/ exists', () => {
    const directory = makeTempDir()
    mkdirSync(join(directory, 'home'), { recursive: true })

    expect(resolveEccSidecarLogDirectory(directory)).toBe(join(directory, 'log'))
  })
})
