import { stat } from 'node:fs/promises'
import type { PdkInstallationRecord, PdkInstallationSnapshot } from '@ecos-studio/shared'
import type { PdkConfigurationService } from './pdkConfigurationService'

/** ECC owns description parsing, process identity and adaptation validation. */
export async function snapshotInstallation(
  installation: PdkInstallationRecord,
  configurationService?: Pick<PdkConfigurationService, 'configure'>,
): Promise<PdkInstallationSnapshot> {
  try {
    const rootStats = await stat(installation.root)
    if (!rootStats.isDirectory()) {
      return {
        ...installation,
        readiness: 'missing',
        reason: 'PDK root is unavailable',
        supportsEccDefaults: false,
      }
    }
    if (!configurationService) {
      return {
        ...installation,
        readiness: 'unverified',
        reason: 'ECC must validate the managed PDK description before this PDK can run',
        supportsEccDefaults: false,
      }
    }
    const description = await configurationService.configure({
      action: 'show',
      root: installation.root,
    })
    if (description.error) {
      return {
        ...installation,
        readiness: 'invalid',
        reason: JSON.stringify(description.error),
        supportsEccDefaults: false,
      }
    }
    const result = await configurationService.configure({
      action: 'validate',
      root: installation.root,
    })
    if (
      result.error ||
      !Array.isArray(result.diagnostics) ||
      result.diagnostics.length > 0
    ) {
      return {
        ...installation,
        readiness: 'invalid',
        reason: JSON.stringify(result),
        supportsEccDefaults: false,
      }
    }
    const context = await configurationService.configure({
      action: 'resolve',
      root: installation.root,
    })
    const digest =
      typeof context.content_digest === 'string' ? context.content_digest : undefined
    if (
      context.error ||
      !digest ||
      !/^[0-9a-f]{64}$/.test(digest) ||
      (installation.pdkDigest
        ? installation.pdkDigest !== context.pdk_digest
        : installation.contentDigest &&
          installation.contentDigest !== digest &&
          installation.contentDigest !== context.legacy_content_digest)
    ) {
      return {
        ...installation,
        readiness: 'invalid',
        reason:
          'PDK content identity changed or could not be verified; import a separate release',
        supportsEccDefaults: false,
      }
    }
    const dataVersion =
      typeof context.data_version === 'string' ? context.data_version : undefined
    const resources = Object.values(
      description.resolved_resources as Record<string, { role: string; path: string }>,
    )
    const techLef = resources.find((item) => item.role === 'tech')?.path
    const cellLefs = resources
      .filter((item) => item.role === 'lef')
      .map((item) => item.path)
    const liberty = resources
      .filter((item) => item.role === 'liberty')
      .map((item) => item.path)
    return {
      ...installation,
      ...(dataVersion ? { dataVersion } : {}),
      version:
        installation.ownership === 'imported' && dataVersion
          ? dataVersion
          : installation.version,
      readiness: 'ready',
      contentDigest: digest,
      ...(typeof context.pdk_digest === 'string'
        ? { pdkDigest: context.pdk_digest }
        : {}),
      ...(typeof context.adaptation_digest === 'string'
        ? { adaptationDigest: context.adaptation_digest }
        : {}),
      ...(typeof description.path === 'string'
        ? { configurationPath: description.path }
        : {}),
      reason: null,
      supportsEccDefaults: Boolean(liberty.length),
      ...(liberty.length
        ? { defaultResources: { techLef: techLef ?? '', cellLefs, liberty } }
        : {}),
    }
  } catch (error) {
    const missing = ['ENOENT', 'ENOTDIR'].includes(
      String((error as NodeJS.ErrnoException).code),
    )
    return {
      ...installation,
      readiness: missing ? 'missing' : 'unverified',
      reason: missing
        ? 'PDK root is unavailable'
        : `ECC validation unavailable: ${String(error)}`,
      supportsEccDefaults: false,
    }
  }
}

export function configurationIdentity(
  snapshot: PdkInstallationSnapshot,
): Partial<PdkInstallationRecord> {
  return {
    version: snapshot.version,
    ...(snapshot.dataVersion ? { dataVersion: snapshot.dataVersion } : {}),
    contentDigest: snapshot.contentDigest,
    pdkDigest: snapshot.pdkDigest,
    adaptationDigest: snapshot.adaptationDigest,
    configurationPath: snapshot.configurationPath,
  }
}
