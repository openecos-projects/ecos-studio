import { describe, expect, it } from 'vitest'
import type { VersionInfo } from '@ecos-studio/shared'
import { aboutVersionRows, buildAboutVersionText } from './aboutDialogVersions'

describe('aboutDialogVersions', () => {
  it('shows ECC and ECC-Tools as distinct component versions', () => {
    const versions: VersionInfo = {
      gui: '0.1.0-alpha.6',
      runtime: 'ECC CLI',
      ecc: '0.1.0a5',
      dreamplace: '0.1.0a3',
      eccTools: '0.1.0a2',
    }

    expect(aboutVersionRows(versions)).toEqual([
      { key: 'gui', label: 'GUI', version: '0.1.0-alpha.6' },
      { key: 'runtime', label: 'Runtime', version: 'ECC CLI' },
      { key: 'ecc', label: 'ECC', version: '0.1.0a5' },
      { key: 'eccTools', label: 'ECC-Tools', version: '0.1.0a2' },
      { key: 'dreamplace', label: 'ECC-DreamPlace', version: '0.1.0a3' },
    ])
  })

  it('does not use legacy bridge version fields as runtime data', () => {
    const versions = {
      gui: '0.1.0-alpha.6',
      legacyRuntime: 'legacy runtime',
      ecc: '0.1.0a5',
      dreamplace: '0.1.0a3',
    } as unknown as VersionInfo

    expect(aboutVersionRows(versions).find((row) => row.key === 'runtime')).toEqual({
      key: 'runtime',
      label: 'Runtime',
      version: 'unknown',
    })
  })

  it('copies the same rows shown in the dialog', () => {
    const versions: VersionInfo = {
      gui: '0.1.0-alpha.6',
      runtime: 'ECC CLI',
      ecc: '0.1.0a5',
      dreamplace: '0.1.0a3',
      eccTools: '0.1.0a2',
    }

    expect(buildAboutVersionText(versions)).toBe([
      'ECOS Studio',
      'GUI: 0.1.0-alpha.6',
      'Runtime: ECC CLI',
      'ECC: 0.1.0a5',
      'ECC-Tools: 0.1.0a2',
      'ECC-DreamPlace: 0.1.0a3',
    ].join('\n'))
  })
})
