import { describe, expect, it } from 'vitest'
import type { CliInstallState, VersionInfo } from '@ecos-studio/shared'
import { aboutVersionRows, buildAboutVersionText } from './aboutDialogVersions'

const versions: VersionInfo = {
  gui: '0.1.0-alpha.9',
  runtime: 'ECC CLI',
  ecc: '0.1.0a12',
  dreamplace: '0.1.0a7',
  eccTools: '0.1.0a13',
}

const installer: CliInstallState = {
  status: 'ready',
  expectedVersion: '0.1.0-alpha.12',
  installedVersion: '0.1.0-alpha.12',
  source: 'bundled',
  versionDir: '/data/ecc/current',
  shimPath: '/home/u/.local/bin/ecos-ecc',
  selfCheck: { ok: true, detail: 'ecc 0.1.0a12' },
  warning: null,
  error: null,
}

describe('aboutDialogVersions', () => {
  it('shows the Studio version alongside expected and installed ECC versions', () => {
    expect(aboutVersionRows({ versions, installer })).toEqual([
      { key: 'gui', label: 'ECOS Studio', version: '0.1.0-alpha.9' },
      { key: 'expectedEcc', label: 'ECC expected', version: '0.1.0-alpha.12' },
      { key: 'installedEcc', label: 'ECC installed', version: '0.1.0-alpha.12' },
      { key: 'eccTools', label: 'ECC-Tools', version: '0.1.0a13' },
      { key: 'dreamplace', label: 'ECC-DreamPlace', version: '0.1.0a7' },
      { key: 'eccSource', label: 'ECC source', version: 'Bundled' },
      { key: 'eccAlignment', label: 'ECC alignment', version: 'Matched' },
    ])
  })

  it('reports external runtime drift as a mismatch', () => {
    const rows = aboutVersionRows({
      versions,
      installer: {
        ...installer,
        source: 'external',
        installedVersion: '0.1.0-alpha.13',
        warning: 'external runtime differs',
      },
    })

    expect(rows.find((row) => row.key === 'eccSource')?.version).toBe('External')
    expect(rows.find((row) => row.key === 'eccAlignment')?.version).toBe('Mismatch')
  })

  it('treats equivalent PEP 440 and semver spellings as matched', () => {
    const rows = aboutVersionRows({
      versions,
      installer: {
        ...installer,
        source: 'external',
        installedVersion: '0.1.0a12',
      },
    })

    expect(rows.find((row) => row.key === 'eccAlignment')?.version).toBe('Matched')
  })

  it('uses the bundled expected version when installer status is unavailable', () => {
    const rows = aboutVersionRows({ versions })

    expect(rows.find((row) => row.key === 'expectedEcc')?.version).toBe('0.1.0-alpha.12')
  })

  it('copies the same rows shown in the dialog', () => {
    expect(buildAboutVersionText({ versions, installer })).toBe(
      [
        'ECOS Studio version information',
        'ECOS Studio: 0.1.0-alpha.9',
        'ECC expected: 0.1.0-alpha.12',
        'ECC installed: 0.1.0-alpha.12',
        'ECC-Tools: 0.1.0a13',
        'ECC-DreamPlace: 0.1.0a7',
        'ECC source: Bundled',
        'ECC alignment: Matched',
      ].join('\n'),
    )
  })
})
