import type { DesktopDownloadSource } from '@ecos-studio/shared'

/**
 * Download-source planning for mirrored registry assets.
 *
 * The registry publishes a `cnb_url` next to the GitHub `url` for assets that
 * have a CNB mirror. The download-source preference decides which source a
 * download attempt uses first:
 *
 * - `github`: never use the mirror;
 * - `cnb`: mirror first, GitHub as fallback;
 * - `auto`: GitHub first, mirror as fallback (the session failover memory may
 *   still skip a host that failed earlier).
 *
 * The PDK base is special: its CNB mirror is a git archive whose bytes and
 * layout differ from the GitHub tarball, so each source verifies against its
 * own checksum (`cnb_sha256`), skips the size check, caches under its own
 * namespace, and extracts with its own strip prefix (`cnb_strip_prefix`).
 */

export interface MirrorUrlPlan {
  primary: string
  mirror: string | null
}

export interface PdkBaseMirrorPlan {
  url: string
  sha256: string
  size: number | null
  fallbackUrl: string | null
  fallbackSize: number | null
}

/** Minimal asset shape the planner needs (satisfied by ResolvedPlatformAsset). */
export interface MirroredAssetLike {
  url: string
  cnb_url?: string | null
  cnb_sha256?: string | null
  cnb_strip_prefix?: string | null
  sha256: string
  size: number | null
  strip_prefix?: string | null
}

export function normalizeMirrorUrl(cnbUrl: string | null | undefined): string | null {
  const mirror = cnbUrl?.trim()
  return mirror ? mirror : null
}

/**
 * Resolve the download order for one mirrored asset from the download-source
 * preference. Session failover ordering is applied later by the downloader.
 */
export function planDownloadUrls(
  url: string,
  cnbUrl: string | null | undefined,
  downloadSource: DesktopDownloadSource,
): MirrorUrlPlan {
  const mirror = normalizeMirrorUrl(cnbUrl)
  if (!mirror || downloadSource === 'github') {
    return { primary: url, mirror: null }
  }
  if (downloadSource === 'cnb') {
    return { primary: mirror, mirror: url }
  }
  return { primary: url, mirror }
}

/**
 * Plan the PDK base download: the CNB mirror is a git archive whose bytes
 * (and size) differ from the GitHub tarball, so each source verifies against
 * its own checksum and caches under its own namespace.
 */
export function planPdkBaseDownload(
  asset: MirroredAssetLike,
  downloadSource: DesktopDownloadSource,
  sessionPrefersMirror: boolean,
): PdkBaseMirrorPlan {
  const mirrorUrl = normalizeMirrorUrl(asset.cnb_url)
  const mirrorDiffers = Boolean(asset.cnb_sha256?.trim())
  // A mirror carrying cnb_sha256 serves different bytes (a git archive):
  // verify against cnb_sha256 and skip the size check because the mirror
  // size is unknown. Without cnb_sha256 the mirror is byte-identical, so
  // the shared sha256 and size apply. The sha256 check stays the
  // authoritative integrity gate either way.
  const mirrorSha256 = mirrorDiffers
    ? asset.cnb_sha256!.trim().toLowerCase()
    : asset.sha256
  const mirrorSize = mirrorDiffers ? null : asset.size
  const mirrorUsable = mirrorUrl !== null && downloadSource !== 'github'
  const preferMirror = mirrorUsable && (downloadSource === 'cnb' || sessionPrefersMirror)
  if (preferMirror) {
    return {
      url: mirrorUrl,
      sha256: mirrorSha256,
      size: mirrorSize,
      fallbackUrl: asset.url,
      fallbackSize: asset.size,
    }
  }
  return {
    url: asset.url,
    sha256: asset.sha256,
    size: asset.size,
    fallbackUrl: mirrorUsable ? mirrorUrl : null,
    fallbackSize: mirrorSize,
  }
}

/** Checksum expected for the PDK base bytes that came from `usedUrl`. */
export function pdkBaseSha256ForUrl(asset: MirroredAssetLike, usedUrl: string): string {
  const mirrorUrl = normalizeMirrorUrl(asset.cnb_url)
  const mirrorSha256 = asset.cnb_sha256?.trim().toLowerCase() || null
  if (mirrorUrl !== null && usedUrl === mirrorUrl) {
    // Without cnb_sha256 the mirror serves byte-identical content.
    return mirrorSha256 ?? asset.sha256
  }
  return asset.sha256
}

/**
 * Strip prefix for the PDK base bytes that came from `usedUrl`: the CNB git
 * archive lacks the GitHub wrapper directory, so the registry marks it with
 * an empty cnb_strip_prefix (extract at root instead of stripping one
 * component). Assets without the field extract like the primary archive.
 */
export function pdkBaseStripPrefixForUrl(
  asset: MirroredAssetLike,
  usedUrl: string,
): string | null {
  const mirrorUrl = normalizeMirrorUrl(asset.cnb_url)
  if (mirrorUrl !== null && usedUrl === mirrorUrl && asset.cnb_strip_prefix != null) {
    return asset.cnb_strip_prefix
  }
  return asset.strip_prefix ?? null
}
