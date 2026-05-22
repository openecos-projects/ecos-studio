import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const serverShimEntrypointEnv = ['ECOS', 'PYINSTALLER', 'ENTRYPOINT'].join('_')
const serverShimEntrypointScript = ['ENTRYPOINT', 'SCRIPT'].join('_')

describe('server bundle build configuration', () => {
  it('does not package the API server into the normal GUI desktop bundle', () => {
    const buildFile = readFileSync(`${repoRoot}ecos/BUILD.bazel`, 'utf8')

    const guiBundleRule = buildFile.slice(buildFile.indexOf('name = "ecos_studio_bundle"'))
    expect(guiBundleRule).not.toContain(':build_ecos_server_bundle')
    expect(guiBundleRule).not.toContain('--api-server-bin')
    expect(guiBundleRule).toContain('@ecc//:build_ecc_cli_bundle')
    expect(guiBundleRule).toContain('--ecc-cli-artifact')
    expect(guiBundleRule).toContain('$(location @ecc//:build_ecc_cli_bundle)')
  })

  it('uses the ECC module for the CLI bundle instead of the server PyInstaller shim', () => {
    const buildFile = readFileSync(`${repoRoot}ecos/BUILD.bazel`, 'utf8')
    const specFile = readFileSync(`${repoRoot}ecos/server/ecos.spec`, 'utf8')

    expect(buildFile).not.toContain('name = "build_ecc_cli_bundle"')
    expect(buildFile).toContain('@ecc//:build_ecc_cli_bundle')
    expect(specFile).not.toContain(serverShimEntrypointEnv)
    expect(specFile).not.toContain(serverShimEntrypointScript)
    expect(specFile).toContain('[str(SERVER_DIR / "run_server.py")]')
  })

  it('keeps the ECC CLI bundle genrule safe when ECC is loaded as an external repo', () => {
    const eccBuildFile = readFileSync(`${repoRoot}ecc/BUILD.bazel`, 'utf8')

    expect(eccBuildFile).toContain('ECC_ROOT="$$(dirname "$(location ecc.spec)")"')
    expect(eccBuildFile).toContain('export PYTHON_INTERPRETER="$$ECC_ROOT/.venv/bin/python"')
    expect(eccBuildFile).not.toContain('export PYTHON_INTERPRETER=".venv/bin/python"')
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
