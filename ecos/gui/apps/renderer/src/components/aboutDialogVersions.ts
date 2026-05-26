import type { VersionInfo } from '@ecos-studio/shared'

export interface AboutVersionRow {
  key: 'gui' | 'runtime' | 'ecc' | 'eccTools' | 'dreamplace'
  label: string
  version: string
}

const UNKNOWN_VERSION = 'unknown'

export function aboutVersionRows(versions?: VersionInfo | null): AboutVersionRow[] {
  return [
    {
      key: 'gui',
      label: 'GUI',
      version: versions?.gui ?? UNKNOWN_VERSION,
    },
    {
      key: 'runtime',
      label: 'Runtime',
      version: versions?.runtime ?? versions?.server ?? UNKNOWN_VERSION,
    },
    {
      key: 'ecc',
      label: 'ECC',
      version: versions?.ecc ?? UNKNOWN_VERSION,
    },
    {
      key: 'eccTools',
      label: 'ECC-Tools',
      version: versions?.eccTools ?? UNKNOWN_VERSION,
    },
    {
      key: 'dreamplace',
      label: 'ECC-DreamPlace',
      version: versions?.dreamplace ?? UNKNOWN_VERSION,
    },
  ]
}

export function buildAboutVersionText(versions?: VersionInfo | null): string {
  const lines = aboutVersionRows(versions)
    .map(({ label, version }) => `${label}: ${version}`)
    .join('\n')

  return `ECOS Studio\n${lines}`
}
