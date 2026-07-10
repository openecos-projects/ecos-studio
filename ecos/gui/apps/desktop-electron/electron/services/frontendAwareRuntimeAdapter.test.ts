import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { explicitFrontendDevelopmentRoot } from './frontendAwareRuntimeAdapter'

describe('frontend runtime source selection', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('does not discover a source checkout implicitly', () => {
    expect(explicitFrontendDevelopmentRoot({})).toBeUndefined()
  })

  it('accepts an explicit development root only when it contains fecompiler', () => {
    const root = mkdtempSync(join(tmpdir(), 'ecos-fe-dev-root-'))
    tempDirs.push(root)

    expect(explicitFrontendDevelopmentRoot({ ECOS_FE_DEV_ROOT: root })).toBeUndefined()

    mkdirSync(join(root, 'fecompiler'))
    expect(explicitFrontendDevelopmentRoot({ ECOS_FE_DEV_ROOT: root })).toBe(root)
  })
})
