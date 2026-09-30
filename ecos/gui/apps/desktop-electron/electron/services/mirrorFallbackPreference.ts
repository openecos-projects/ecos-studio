/**
 * Session-scoped memory of download hosts that already failed over to their
 * mirror. Once a primary host is recorded, later downloads skip the primary
 * URL and start from the mirror instead of repeating the failing retries.
 */
export interface MirrorFallbackPreference {
  /** True when the primary URL's host failed over to a mirror earlier. */
  prefersMirror(primaryUrl: string): boolean
  /** Remember that the primary URL's host failed and the mirror was used. */
  recordFailover(primaryUrl: string): void
  /** Forget a recorded failover, e.g. after a primary download succeeds. */
  clearFailover(primaryUrl: string): void
}

export function createMirrorFallbackPreference(): MirrorFallbackPreference {
  const failedHosts = new Set<string>()
  return {
    prefersMirror(primaryUrl) {
      const host = hostKeyFor(primaryUrl)
      return host !== null && failedHosts.has(host)
    },
    recordFailover(primaryUrl) {
      const host = hostKeyFor(primaryUrl)
      if (host !== null) failedHosts.add(host)
    },
    clearFailover(primaryUrl) {
      const host = hostKeyFor(primaryUrl)
      if (host !== null) failedHosts.delete(host)
    },
  }
}

function hostKeyFor(url: string): string | null {
  try {
    const host = new URL(url).host
    return host === '' ? null : host
  } catch {
    return null
  }
}
