import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const roots: string[] = []
afterEach(() =>
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })),
)

function fixture(wrapper: string) {
  const root = mkdtempSync(join(tmpdir(), 'ecos-sizer-stage-'))
  roots.push(root)
  const script = join(root, '.github/scripts/build-binaries.sh')
  mkdirSync(dirname(script), { recursive: true })
  copyFileSync(
    new URL('../../../../.github/scripts/build-binaries.sh', import.meta.url),
    script,
  )
  const source = join(root, 'source')
  for (const name of [
    'bin/Sizer',
    'libexec/Sizer',
    'lib/ld-linux-x86-64.so.2',
    'src/sizer_os.tcl',
  ]) {
    const path = join(source, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, name === 'bin/Sizer' ? wrapper : 'fixture', { mode: 0o755 })
  }
  const target = join(root, 'ecos/gui/apps/desktop-electron/resources/binaries/sizer')
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'previous-runtime'), 'preserve on failure')
  writeFileSync(join(target, '../ecc'), 'unrelated binary')
  const run = () =>
    spawnSync('bash', [script, '--sizer-only'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CHIPCOMPILER_ECC_SIZER_ROOT: source,
        LD_LIBRARY_PATH: '/unrelated',
        LD_PRELOAD: '',
      },
    })
  return { run, source, target }
}

it('stages only Sizer after a clean-environment startup probe', () => {
  const { run, source, target } = fixture(`#!/usr/bin/env bash
set -euo pipefail
[[ ! -v LD_LIBRARY_PATH && ! -v LD_PRELOAD ]]
[[ "$*" == '-env /dev/null -f /dev/null' ]]
`)
  const result = run()
  expect({ status: result.status, stderr: result.stderr }).toEqual({
    status: 0,
    stderr: '',
  })
  expect(readFileSync(join(target, 'bin/Sizer'), 'utf8')).toBe(
    readFileSync(join(source, 'bin/Sizer'), 'utf8'),
  )
  expect(readFileSync(join(target, '../ecc'), 'utf8')).toBe('unrelated binary')
})

it('rejects an ODR-broken runtime before replacing the installed one', () => {
  const { run, target } = fixture(`#!/usr/bin/env bash
echo "Inconsistency between flag object and registration for flag 'stderrthreshold'" >&2
exit 1
`)
  const result = run()
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('stderrthreshold')
  expect(readFileSync(join(target, 'previous-runtime'), 'utf8')).toBe(
    'preserve on failure',
  )
})
