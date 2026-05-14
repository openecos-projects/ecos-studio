import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

describe('server bundle build configuration', () => {
  it('routes the GUI bundle through a dedicated onedir API server bundle artifact target', () => {
    const buildFile = readFileSync(`${repoRoot}ecos/BUILD.bazel`, 'utf8')

    expect(buildFile).toContain('name = "build_ecos_server_bundle"')
    expect(buildFile).toContain('--api-server-bin "$(location :build_ecos_server_bundle)"')
  })

  it('allows the PyInstaller spec to switch between onefile and onedir modes', () => {
    const specFile = readFileSync(`${repoRoot}ecos/server/ecos.spec`, 'utf8')

    expect(specFile).toContain('ECOS_PYINSTALLER_MODE')
    expect(specFile).toContain('COLLECT(')
  })

  it('defaults the PyInstaller API server bundle to onedir mode', () => {
    const specFile = readFileSync(`${repoRoot}ecos/server/ecos.spec`, 'utf8')

    expect(specFile).toContain(
      'BUNDLE_MODE = os.environ.get("ECOS_PYINSTALLER_MODE", "onedir").strip().lower()',
    )
  })
})
