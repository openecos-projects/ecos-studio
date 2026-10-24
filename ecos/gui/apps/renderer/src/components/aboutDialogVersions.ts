import {
  EXPECTED_ECC_BUNDLE_VERSION,
  normalizeEccVersion,
  type CliInstallSource,
  type CliInstallState,
  type VersionInfo,
} from '@ecos-studio/shared'

export interface AboutVersionRow {
  key:
    | 'gui'
    | 'expectedEcc'
    | 'installedEcc'
    | 'eccTools'
    | 'dreamplace'
    | 'eccSource'
    | 'eccAlignment'
  label: string
  version: string
}

export interface AboutVersionData {
  versions?: VersionInfo | null
  installer?: CliInstallState | null
}

const UNKNOWN_VERSION = 'unknown'

function sourceLabel(source: CliInstallSource | null | undefined): string {
  switch (source) {
    case 'bundled':
      return 'Bundled'
    case 'downloaded':
      return 'Downloaded'
    case 'external':
      return 'External'
    default:
      return UNKNOWN_VERSION
  }
}

function alignmentLabel(
  installer: CliInstallState | null | undefined,
  versions: VersionInfo | null | undefined,
): string {
  if (!installer) return UNKNOWN_VERSION
  if (installer.status === 'installing') return 'Installing'
  if (installer.status === 'not-installed') return 'Not installed'
  if (installer.status === 'unsupported') return 'Unsupported'
  if (installer.warning) return 'Mismatch'

  const installedVersion = installer.installedVersion ?? versions?.ecc ?? null
  if (!installedVersion) return UNKNOWN_VERSION
  if (!installer.expectedVersion) return UNKNOWN_VERSION
  return normalizeEccVersion(installedVersion) ===
    normalizeEccVersion(installer.expectedVersion)
    ? 'Matched'
    : 'Mismatch'
}

export function aboutVersionRows({
  versions,
  installer,
}: AboutVersionData = {}): AboutVersionRow[] {
  return [
    {
      key: 'gui',
      label: 'ECOS Studio',
      version: versions?.gui ?? UNKNOWN_VERSION,
    },
    {
      key: 'expectedEcc',
      label: 'ECC expected',
      version: installer?.expectedVersion ?? EXPECTED_ECC_BUNDLE_VERSION,
    },
    {
      key: 'installedEcc',
      label: 'ECC installed',
      version: installer?.installedVersion ?? versions?.ecc ?? UNKNOWN_VERSION,
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
    {
      key: 'eccSource',
      label: 'ECC source',
      version: sourceLabel(installer?.source),
    },
    {
      key: 'eccAlignment',
      label: 'ECC alignment',
      version: alignmentLabel(installer, versions),
    },
  ]
}

export function buildAboutVersionText(data: AboutVersionData = {}): string {
  const lines = aboutVersionRows(data)
    .map(({ label, version }) => `${label}: ${version}`)
    .join('\n')

  return `ECOS Studio version information\n${lines}`
}
