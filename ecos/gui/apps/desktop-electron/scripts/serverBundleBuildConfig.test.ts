import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

describe('server bundle build configuration', () => {
  it('does not package the API server into the normal GUI desktop bundle', () => {
    const buildFile = readFileSync(`${repoRoot}ecos/BUILD.bazel`, 'utf8')

    const guiBundleRule = buildFile.slice(buildFile.indexOf('name = "ecos_studio_bundle"'))
    expect(guiBundleRule).not.toContain(':build_ecos_server_bundle')
    expect(guiBundleRule).not.toContain('--api-server-bin')
    expect(guiBundleRule).toContain(':build_ecc_cli_bundle')
    expect(guiBundleRule).toContain('--ecc-cli-artifact')
  })

  it('builds the ECC CLI bundle with the PyInstaller CLI entry point', () => {
    const buildFile = readFileSync(`${repoRoot}ecos/BUILD.bazel`, 'utf8')
    const cliBundleRule = buildFile.slice(buildFile.indexOf('name = "build_ecc_cli_bundle"'))
    const specFile = readFileSync(`${repoRoot}ecos/server/ecos.spec`, 'utf8')
    const entryFile = readFileSync(`${repoRoot}ecos/server/run_ecc_cli.py`, 'utf8')
    const entryModule = readFileSync(`${repoRoot}ecos/server/ecos_server/run_ecc_cli.py`, 'utf8')

    expect(cliBundleRule).toContain('export PYTHONPATH="$$PWD/ecc:$${PYTHONPATH:-}"')
    expect(cliBundleRule).toContain('ECOS_PYINSTALLER_ENTRYPOINT="ecc-cli"')
    expect(specFile).toContain('ENTRYPOINT = os.environ.get("ECOS_PYINSTALLER_ENTRYPOINT", "ecos-server")')
    expect(specFile).toContain('ENTRYPOINT_SCRIPT = "run_ecc_cli.py"')
    expect(entryFile).toContain('from ecos_server.run_ecc_cli import main')
    expect(entryModule).toContain('workspace_subparsers.add_parser("run-step")')
    expect(entryModule).toContain('_dispatch(service, "run_step"')
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
