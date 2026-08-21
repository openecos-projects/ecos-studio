import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  discoverFrontendDevelopmentRoot,
  explicitFrontendDevelopmentRoot,
  resolveFrontendDevelopmentRoot,
} from './frontendDevelopmentRoot'

const roots: string[] = []

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'frontend-development-root-'))
  roots.push(root)
  return root
}

describe('frontend development root discovery', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('accepts an explicit ecc-fe checkout', () => {
    const root = createTempRoot()
    mkdirSync(join(root, 'fecompiler'))

    expect(explicitFrontendDevelopmentRoot({ ECOS_FE_DEV_ROOT: root })).toBe(root)
  })

  it('discovers a nested ecc-fe checkout from a workspace root', () => {
    const workspaceRoot = createTempRoot()
    const frontendRoot = join(workspaceRoot, 'ecc-fe')
    mkdirSync(join(frontendRoot, 'fecompiler'), { recursive: true })

    expect(discoverFrontendDevelopmentRoot(workspaceRoot)).toBe(frontendRoot)
    expect(
      resolveFrontendDevelopmentRoot({
        env: {},
        searchRoots: [workspaceRoot],
      }),
    ).toBe(frontendRoot)
  })

  it('ignores an explicit path that is not an ecc-fe checkout', () => {
    const invalidRoot = createTempRoot()

    expect(
      resolveFrontendDevelopmentRoot({
        env: { ECOS_FE_DEV_ROOT: invalidRoot },
        searchRoots: [],
      }),
    ).toBeUndefined()
  })
})
