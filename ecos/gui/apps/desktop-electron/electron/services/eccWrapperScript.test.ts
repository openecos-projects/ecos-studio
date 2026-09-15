import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function findRepositoryRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(current, 'ecos', 'scripts', 'ecc-wrapper.sh'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('repository root not found from test location')
}

function createWrapperFixture(): {
  callerDir: string
  eccProject: string
  fixtureRoot: string
  wrapperPath: string
} {
  const repoRoot = findRepositoryRoot()
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'ecos-studio-ecc-wrapper-'))
  const eccProject = join(fixtureRoot, 'ecc')
  mkdirSync(eccProject)
  writeFileSync(join(eccProject, 'pyproject.toml'), '[project]\nname = "ecc"\n')

  const scriptsDir = join(fixtureRoot, 'ecos', 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  const wrapperPath = join(scriptsDir, 'ecc-wrapper.sh')
  copyFileSync(join(repoRoot, 'ecos', 'scripts', 'ecc-wrapper.sh'), wrapperPath)

  const callerDir = join(fixtureRoot, 'caller')
  mkdirSync(callerDir)

  return { callerDir, eccProject, fixtureRoot, wrapperPath }
}

function writeCaptureScript(path: string, captureVariable: string): void {
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$(pwd)" "$@" > "$${captureVariable}"\n`)
  chmodSync(path, 0o755)
}

describe('ecc-wrapper.sh', () => {
  it.skipIf(process.platform === 'win32')(
    'preserves the caller cwd and passes the ecc project explicitly to uv',
    () => {
      const { callerDir, eccProject, fixtureRoot, wrapperPath } = createWrapperFixture()

      const binDir = join(fixtureRoot, 'bin')
      mkdirSync(binDir)
      const uvCapture = join(fixtureRoot, 'uv-capture.txt')
      writeCaptureScript(join(binDir, 'uv'), 'UV_CAPTURE_FILE')

      const result = spawnSync('bash', [wrapperPath, 'run', '--project', 'gcd'], {
        cwd: callerDir,
        encoding: 'utf8',
        env: {
          HOME: fixtureRoot,
          PATH: `${binDir}:/usr/bin:/bin`,
          UV_CAPTURE_FILE: uvCapture,
        },
      })
      expect(result.stderr).toContain('[ecc-wrapper]')
      expect(result.status).toBe(0)

      const [capturedCwd, ...capturedArgs] = readFileSync(uvCapture, 'utf8')
        .trim()
        .split('\n')
      expect(capturedCwd).toBe(callerDir)
      expect(capturedArgs).toEqual([
        'run',
        '--project',
        eccProject,
        'ecc',
        'run',
        '--project',
        'gcd',
      ])
    },
  )

  it.skipIf(process.platform === 'win32')(
    'passes the flake path and ecc project explicitly in the nix branch',
    () => {
      const { callerDir, eccProject, fixtureRoot, wrapperPath } = createWrapperFixture()

      const binDir = join(fixtureRoot, 'bin')
      mkdirSync(binDir, { recursive: true })
      const nixCapture = join(fixtureRoot, 'nix-capture.txt')
      writeCaptureScript(join(binDir, 'nix'), 'NIX_CAPTURE_FILE')

      const result = spawnSync('bash', [wrapperPath, '--version'], {
        cwd: callerDir,
        encoding: 'utf8',
        env: {
          ECOS_ECC_USE_NIX: '1',
          HOME: fixtureRoot,
          NIX_CAPTURE_FILE: nixCapture,
          PATH: `${binDir}:/usr/bin:/bin`,
        },
      })
      expect(result.stderr).toContain('[ecc-wrapper]')
      expect(result.status).toBe(0)

      const [capturedCwd, ...capturedArgs] = readFileSync(nixCapture, 'utf8')
        .trim()
        .split('\n')
      expect(capturedCwd).toBe(callerDir)
      expect(capturedArgs).toEqual([
        'develop',
        eccProject,
        '--command',
        'uv',
        'run',
        '--project',
        eccProject,
        'ecc',
        '--version',
      ])
    },
  )
})
