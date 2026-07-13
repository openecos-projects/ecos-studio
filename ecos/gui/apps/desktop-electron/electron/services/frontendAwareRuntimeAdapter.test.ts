import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  discoverFrontendDevelopmentRoot,
  explicitFrontendDevelopmentRoot,
  resolveFrontendDevelopmentRoot,
} from './frontendAwareRuntimeAdapter'

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

  it('discovers ecc-fe when a repository root is provided', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-repo-root-'))
    tempDirs.push(repoRoot)
    const frontendRoot = join(repoRoot, 'ecc-fe')
    mkdirSync(join(frontendRoot, 'fecompiler'), { recursive: true })

    expect(discoverFrontendDevelopmentRoot(join(repoRoot, 'ecos', 'gui'))).toBe(frontendRoot)
    expect(resolveFrontendDevelopmentRoot({ searchRoots: [join(repoRoot, 'ecos', 'gui')] })).toBe(frontendRoot)
  })

  it('keeps ECOS_FE_DEV_ROOT ahead of discovered source roots', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'ecos-repo-root-'))
    const explicitRoot = mkdtempSync(join(tmpdir(), 'ecos-explicit-fe-root-'))
    tempDirs.push(repoRoot, explicitRoot)
    mkdirSync(join(repoRoot, 'ecc-fe', 'fecompiler'), { recursive: true })
    mkdirSync(join(explicitRoot, 'fecompiler'), { recursive: true })

    expect(resolveFrontendDevelopmentRoot({
      env: { ECOS_FE_DEV_ROOT: explicitRoot },
      searchRoots: [repoRoot],
    })).toBe(explicitRoot)
  })
})
