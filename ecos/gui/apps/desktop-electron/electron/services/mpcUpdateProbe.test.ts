import { afterEach, describe, expect, it, vi } from 'vitest'

const electronLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  status: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('./logger', () => ({
  electronLogger,
}))

import {
  fetchGitHubBranchHead,
  parseGitHubArchiveCommit,
  parseGitHubRepo,
} from './mpcUpdateProbe'

const COMMIT_A = '1'.repeat(40)
const COMMIT_B = '2'.repeat(40)

afterEach(() => {
  vi.useRealTimers()
  electronLogger.debug.mockReset()
})

describe('parseGitHubArchiveCommit', () => {
  it.each([
    `https://codeload.github.com/openecos-projects/mpc-frame/tar.gz/${COMMIT_A}`,
    `https://codeload.github.com/openecos-projects/mpc-frame/zip/${COMMIT_A}`,
    `https://github.com/openecos-projects/mpc-frame/archive/${COMMIT_A}.tar.gz`,
    `https://github.com/openecos-projects/mpc-frame/archive/${COMMIT_A}.zip`,
  ])('extracts the pinned commit from %s', (url) => {
    expect(parseGitHubArchiveCommit(url)).toEqual({
      owner: 'openecos-projects',
      repo: 'mpc-frame',
      commit: COMMIT_A,
    })
  })

  it.each([
    [
      'a tag archive',
      'https://github.com/openecos-projects/mpc-frame/archive/v0.1.0.tar.gz',
    ],
    [
      'a refs/tags archive',
      'https://github.com/openecos-projects/mpc-frame/archive/refs/tags/v0.1.0.tar.gz',
    ],
    [
      'a codeload tag ref',
      'https://codeload.github.com/openecos-projects/mpc-frame/tar.gz/v0.1.0',
    ],
    [
      'a short commit ref',
      `https://github.com/openecos-projects/mpc-frame/archive/${COMMIT_A.slice(0, 7)}.tar.gz`,
    ],
    ['a non-GitHub URL', 'https://example.com/mpc-frame.tar.gz'],
    ['a plain repository URL', 'https://github.com/openecos-projects/mpc-frame'],
    ['an invalid URL', 'not a url'],
    ['an empty string', ''],
  ])('returns null for %s', (_label, url) => {
    expect(parseGitHubArchiveCommit(url)).toBeNull()
  })
})

describe('parseGitHubRepo', () => {
  it.each([
    `https://codeload.github.com/openecos-projects/mpc-frame/tar.gz/${COMMIT_A}`,
    `https://github.com/openecos-projects/mpc-frame/archive/${COMMIT_A}.tar.gz`,
    'https://github.com/openecos-projects/mpc-frame/archive/v0.1.0.tar.gz',
    'https://github.com/openecos-projects/mpc-frame',
  ])('locates the repository for %s', (url) => {
    expect(parseGitHubRepo(url)).toEqual({
      owner: 'openecos-projects',
      repo: 'mpc-frame',
    })
  })

  it.each([
    ['a non-GitHub URL', 'https://example.com/mpc-frame.tar.gz'],
    [
      'a non-archive repository path',
      'https://github.com/openecos-projects/mpc-frame/issues/1',
    ],
    ['an invalid URL', 'not a url'],
  ])('returns null for %s', (_label, url) => {
    expect(parseGitHubRepo(url)).toBeNull()
  })
})

describe('fetchGitHubBranchHead', () => {
  it('returns the branch head commit', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ sha: COMMIT_B }), { status: 200 }),
    )

    await expect(
      fetchGitHubBranchHead(
        fetchImpl as typeof fetch,
        'openecos-projects',
        'mpc-frame',
        'main',
      ),
    ).resolves.toBe(COMMIT_B)

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/openecos-projects/mpc-frame/commits/main',
      expect.objectContaining({
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ecos-studio',
        },
      }),
    )
  })

  it('returns null when the API responds with an error status', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }))

    await expect(
      fetchGitHubBranchHead(
        fetchImpl as typeof fetch,
        'openecos-projects',
        'mpc-frame',
        'main',
      ),
    ).resolves.toBeNull()
  })

  it('returns null when the API payload has no commit sha', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'unexpected' }), { status: 200 }),
    )

    await expect(
      fetchGitHubBranchHead(
        fetchImpl as typeof fetch,
        'openecos-projects',
        'mpc-frame',
        'main',
      ),
    ).resolves.toBeNull()
  })

  it('returns null when the API payload is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>', { status: 200 }))

    await expect(
      fetchGitHubBranchHead(
        fetchImpl as typeof fetch,
        'openecos-projects',
        'mpc-frame',
        'main',
      ),
    ).resolves.toBeNull()
  })

  it('returns null when the request fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused')
    })

    await expect(
      fetchGitHubBranchHead(
        fetchImpl as typeof fetch,
        'openecos-projects',
        'mpc-frame',
        'main',
      ),
    ).resolves.toBeNull()
  })

  it('returns null when the probe times out', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      async (_input: unknown, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    )

    const probe = fetchGitHubBranchHead(
      fetchImpl as unknown as typeof fetch,
      'openecos-projects',
      'mpc-frame',
      'main',
      1000,
    )
    await vi.advanceTimersByTimeAsync(1000)

    await expect(probe).resolves.toBeNull()
  })
})
