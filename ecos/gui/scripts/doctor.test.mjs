import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runGuiDoctor } from './doctor.mjs'

function createDoctorFixture(overrides = {}) {
  const existingPaths = new Set(overrides.existingPaths ?? [])
  const commands = new Map(overrides.commands ?? [])
  const cwd = overrides.cwd ?? '/repo/ecos/gui'

  return runGuiDoctor({
    access: async (path) => {
      if (!existingPaths.has(path)) {
        throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' })
      }
    },
    cwd,
    execFile: async (command, args = []) => {
      const key = [command, ...args].join(' ')
      if (!commands.has(key)) {
        throw Object.assign(new Error(`command failed: ${key}`), { code: 'ENOENT' })
      }
      return commands.get(key)
    },
    platform: overrides.platform ?? 'linux',
    versions: overrides.versions ?? {
      node: 'v25.0.6',
    },
  })
}

describe('runGuiDoctor', () => {
  it('reports a healthy GUI development environment', async () => {
    const cwd = '/repo/ecos/gui'

    const report = await createDoctorFixture({
      cwd,
      existingPaths: [
        join(cwd, 'node_modules/.modules.yaml'),
        join(cwd, 'apps/desktop-electron/resources/binaries/ecc'),
        join(cwd, 'apps/desktop-electron/resources/binaries/ecc-geometry-snapshot'),
        join(cwd, 'apps/desktop-electron/resources/binaries/chip-viewer-native'),
      ],
      commands: [
        ['pnpm --version', { stdout: '11.0.9\n' }],
        ['ecc --version', { stdout: 'ecc 0.1.0a5\n' }],
        ['nix --version', { stdout: 'nix (Nix) 2.24.0\n' }],
      ],
    })

    expect(report.summary).toEqual({
      errors: 0,
      ok: 6,
      warnings: 0,
    })
    expect(report.checks.map((check) => check.name)).toEqual([
      'Node.js',
      'pnpm',
      'pnpm install',
      'ECC CLI',
      'native resources',
      'Nix',
    ])
  })

  it('marks missing install state and native resources as errors', async () => {
    const cwd = '/repo/ecos/gui'

    const report = await createDoctorFixture({
      cwd,
      commands: [
        ['pnpm --version', { stdout: '11.0.9\n' }],
        ['ecc --version', { stdout: 'ecc 0.1.0a5\n' }],
        ['nix --version', { stdout: 'nix (Nix) 2.24.0\n' }],
      ],
    })

    expect(report.summary.errors).toBe(2)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'pnpm install',
          status: 'error',
        }),
        expect.objectContaining({
          name: 'native resources',
          status: 'error',
        }),
      ]),
    )
  })

  it('marks optional external tools as warnings', async () => {
    const cwd = '/repo/ecos/gui'

    const report = await createDoctorFixture({
      cwd,
      existingPaths: [
        join(cwd, 'node_modules/.modules.yaml'),
        join(cwd, 'apps/desktop-electron/resources/binaries/ecc'),
        join(cwd, 'apps/desktop-electron/resources/binaries/ecc-geometry-snapshot'),
        join(cwd, 'apps/desktop-electron/resources/binaries/chip-viewer-native'),
      ],
      commands: [['pnpm --version', { stdout: '11.0.9\n' }]],
    })

    expect(report.summary).toEqual({
      errors: 0,
      ok: 4,
      warnings: 2,
    })
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ECC CLI',
          status: 'warning',
        }),
        expect.objectContaining({
          name: 'Nix',
          status: 'warning',
        }),
      ]),
    )
  })

  it('requires packaged chip viewer resources', async () => {
    const cwd = '/repo/ecos/gui'

    const report = await createDoctorFixture({
      cwd,
      existingPaths: [join(cwd, 'node_modules/.modules.yaml')],
      commands: [
        ['pnpm --version', { stdout: '11.0.9\n' }],
        ['ecc --version', { stdout: 'ecc 0.1.0a5\n' }],
        ['nix --version', { stdout: 'nix (Nix) 2.24.0\n' }],
      ],
    })

    expect(report.summary.errors).toBe(1)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'native resources',
          status: 'error',
          message:
            'Missing native resources: ecc, ecc-geometry-snapshot, chip-viewer-native',
        }),
      ]),
    )
  })
})
