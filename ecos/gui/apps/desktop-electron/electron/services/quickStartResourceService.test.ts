import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveQuickStartResources } from './quickStartResourceService'

const roots: string[] = []

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'quick-start-resources-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('resolveQuickStartResources', () => {
  it('resolves the checked-in design and PDK in development mode', () => {
    const repoRoot = createRoot()
    const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
    const designPath = join(repoRoot, 'ecc', 'docs', 'examples', 'gcd', 'gcd.v')
    const pdkPath = join(repoRoot, 'pdk', 'icsprout55-pdk')
    mkdirSync(join(repoRoot, 'ecc', 'docs', 'examples', 'gcd'), { recursive: true })
    mkdirSync(pdkPath, { recursive: true })
    writeFileSync(designPath, 'module gcd; endmodule\n')

    expect(
      resolveQuickStartResources({
        appPath,
        isPackaged: false,
        resourcesPath: join(repoRoot, 'resources'),
      }),
    ).toEqual({
      design: { id: 'local:gcd', path: designPath, version: 'local' },
      diagnostics: [],
      pdk: { id: 'pdk:ics55', path: pdkPath, version: 'local' },
    })
  })

  it('resolves the GCD extraResource in packaged mode', () => {
    const root = createRoot()
    const resourcesPath = join(root, 'resources')
    const designPath = join(resourcesPath, 'agent', 'quick-start', 'gcd.v')
    mkdirSync(join(resourcesPath, 'agent', 'quick-start'), { recursive: true })
    writeFileSync(designPath, 'module gcd; endmodule\n')

    expect(
      resolveQuickStartResources({
        appPath: join(root, 'app.asar'),
        isPackaged: true,
        resourcesPath,
      }),
    ).toEqual({
      design: { id: 'local:gcd', path: designPath, version: 'local' },
      diagnostics: [
        `Built-in ICS55 PDK is unavailable at ${join(resourcesPath, 'agent', 'quick-start', 'pdk', 'icsprout55-pdk')}.`,
      ],
      pdk: null,
    })
  })

  it('rejects a directory used as the design and a file used as the PDK', () => {
    const repoRoot = createRoot()
    const appPath = join(repoRoot, 'ecos', 'gui', 'apps', 'desktop-electron')
    mkdirSync(join(repoRoot, 'ecc', 'docs', 'examples', 'gcd', 'gcd.v'), {
      recursive: true,
    })
    mkdirSync(join(repoRoot, 'pdk'), { recursive: true })
    writeFileSync(join(repoRoot, 'pdk', 'icsprout55-pdk'), 'not a directory')

    expect(
      resolveQuickStartResources({
        appPath,
        isPackaged: false,
        resourcesPath: join(repoRoot, 'resources'),
      }),
    ).toEqual({
      design: null,
      diagnostics: [
        `Built-in GCD example is unavailable at ${join(repoRoot, 'ecc', 'docs', 'examples', 'gcd', 'gcd.v')}.`,
        `Built-in ICS55 PDK is unavailable at ${join(repoRoot, 'pdk', 'icsprout55-pdk')}.`,
      ],
      pdk: null,
    })
  })
})
