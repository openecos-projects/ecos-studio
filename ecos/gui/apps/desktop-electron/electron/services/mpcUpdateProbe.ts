/**
 * Probes the upstream branch head of GitHub-sourced MPC archives so same-version
 * republishes can be detected even when the registry lock has not caught up.
 * Every failure is reported as a null result: probing must never surface as an
 * error in the Resource Manager.
 */
import { electronLogger } from './logger'

const GITHUB_COMMIT_PATTERN = /^[0-9a-f]{40}$/

export interface GitHubArchiveCommit {
  owner: string
  repo: string
  commit: string
}

export interface GitHubRepo {
  owner: string
  repo: string
}

function parseGitHubArchiveRef(
  sourceUrl: string,
): { owner: string; repo: string; ref: string } | null {
  let url: URL
  try {
    url = new URL(sourceUrl)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.hostname === 'codeload.github.com') {
    if (parts.length !== 4) return null
    const [owner, repo, format, ref] = parts
    if (format !== 'tar.gz' && format !== 'zip') return null
    if (!owner || !repo || !ref) return null
    return { owner, repo, ref }
  }
  if (url.hostname === 'github.com') {
    if (parts.length !== 4 || parts[2] !== 'archive') return null
    const [owner, repo, , archiveRef] = parts
    const ref = archiveRef.replace(/\.tar\.gz$|\.zip$/, '')
    if (ref === archiveRef || !owner || !repo || !ref) return null
    return { owner, repo, ref }
  }
  return null
}

/** Extracts the pinned 40-hex commit from a GitHub source archive URL. */
export function parseGitHubArchiveCommit(url: string): GitHubArchiveCommit | null {
  const parsed = parseGitHubArchiveRef(url)
  if (!parsed) return null
  const commit = parsed.ref.toLowerCase()
  if (!GITHUB_COMMIT_PATTERN.test(commit)) return null
  return { owner: parsed.owner, repo: parsed.repo, commit }
}

/** Locates the GitHub repository behind a source archive or repository URL. */
export function parseGitHubRepo(url: string): GitHubRepo | null {
  const parsed = parseGitHubArchiveRef(url)
  if (parsed) return { owner: parsed.owner, repo: parsed.repo }
  try {
    const plain = new URL(url)
    if (plain.hostname !== 'github.com') return null
    const parts = plain.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) return null
    const [owner, repo] = parts
    if (!owner || !repo) return null
    return { owner, repo }
  } catch {
    return null
  }
}

/**
 * Resolves the head commit of a GitHub branch via the REST API. Returns null on
 * non-OK responses, timeouts, and malformed payloads.
 */
export async function fetchGitHubBranchHead(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
  branch: string,
  timeoutMs = 8000,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ecos-studio',
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      electronLogger.debug(
        '[resources] GitHub branch probe failed with %d: %s',
        response.status,
        url,
      )
      return null
    }
    const body: unknown = await response.json()
    const sha =
      body && typeof body === 'object' ? (body as { sha?: unknown }).sha : undefined
    const commit = typeof sha === 'string' ? sha.toLowerCase() : ''
    if (!GITHUB_COMMIT_PATTERN.test(commit)) {
      electronLogger.debug(
        '[resources] GitHub branch probe returned no commit sha: %s',
        url,
      )
      return null
    }
    return commit
  } catch (error) {
    electronLogger.debug(
      '[resources] GitHub branch probe failed for %s: %s',
      url,
      error instanceof Error ? error.message : String(error),
    )
    return null
  } finally {
    clearTimeout(timeout)
  }
}
