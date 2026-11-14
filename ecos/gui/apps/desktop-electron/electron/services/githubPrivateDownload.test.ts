import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchResourceArchive } from './githubPrivateDownload'

const source = `https://api.github.com/repos/openecos-projects/icsprout55-pdk-v2/tarball/${'a'.repeat(40)}`

afterEach(() => vi.unstubAllEnvs())

describe('private PDK downloads', () => {
  it('authorizes the API and preserves resume/cancellation without forwarding the token', async () => {
    vi.stubEnv('GH_TOKEN', 'test-token')
    const target =
      'https://codeload.github.com/openecos-projects/icsprout55-pdk-v2/legacy.tar.gz/abc?token=signed'
    const archive = new Response('archive', { status: 206 })
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: target } }),
      )
      .mockResolvedValueOnce(archive)
    const request = {
      headers: { Range: 'bytes=123-' },
      signal: new AbortController().signal,
    }
    expect(await fetchResourceArchive(fetchImpl, source, request)).toBe(archive)
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe(
      'Bearer test-token',
    )
    expect(fetchImpl.mock.calls[1]).toEqual([target, { ...request, redirect: 'error' }])
  })

  it('leaves public downloads and unrelated API repositories unauthenticated', async () => {
    vi.stubEnv('GH_TOKEN', 'test-token')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('public'))
    for (const url of [
      'https://github.com/owner/repo/archive/main.tar.gz',
      source.replace('icsprout55-pdk-v2', 'other'),
    ]) {
      await fetchResourceArchive(fetchImpl, url, {})
      expect(fetchImpl).toHaveBeenLastCalledWith(url, {})
    }
  })

  it('requires authorization before requesting the private archive', async () => {
    vi.stubEnv('GH_TOKEN', '')
    vi.stubEnv('GITHUB_TOKEN', '')
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(fetchResourceArchive(fetchImpl, source, {})).rejects.toThrow(
      'Contents: read',
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects redirects to another host', async () => {
    vi.stubEnv('GH_TOKEN', 'test-token')
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/private' },
      }),
    )
    await expect(fetchResourceArchive(fetchImpl, source, {})).rejects.toThrow('invalid')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not expose signed URLs from transport errors', async () => {
    vi.stubEnv('GH_TOKEN', 'test-token')
    const target = 'https://codeload.github.com/repo?token=secret'
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: target } }),
      )
      .mockRejectedValueOnce(new Error(target))
    await expect(fetchResourceArchive(fetchImpl, source, {})).rejects.toThrow(
      /^Private PDK archive transfer failed$/,
    )
  })
})
