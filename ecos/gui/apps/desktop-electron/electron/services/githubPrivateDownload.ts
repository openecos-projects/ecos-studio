/** Fetch a pinned private PDK archive without forwarding credentials to mirrors. */
export async function fetchResourceArchive(
  fetchImpl: typeof fetch,
  source: string,
  request: RequestInit,
): Promise<Response> {
  const url = new URL(source)
  if (
    url.origin !== 'https://api.github.com' ||
    !/^\/repos\/openecos-projects\/icsprout55-pdk-v2\/tarball\/[0-9a-f]{40}$/.test(
      url.pathname,
    ) ||
    url.username ||
    url.password ||
    url.search
  ) {
    return fetchImpl(source, request)
  }
  const token = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim()
  if (!token) {
    throw new Error(
      'Private ICS55 PDK access requires GH_TOKEN or GITHUB_TOKEN with repository Contents: read permission. Set it before starting Studio.',
    )
  }
  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const response = await fetchImpl(source, { ...request, headers, redirect: 'manual' })
  if (response.status !== 302) return response
  const location = response.headers.get('location')
  await response.body?.cancel()
  const target = location ? new URL(location) : null
  if (
    !target ||
    target.origin !== 'https://codeload.github.com' ||
    target.username ||
    target.password
  ) {
    throw new Error('GitHub returned an invalid private archive download redirect')
  }
  try {
    // This signed URL is temporary. Do not log it or send the API token to it.
    return await fetchImpl(target.href, { ...request, redirect: 'error' })
  } catch (error) {
    if (request.signal?.aborted) throw error
    throw new Error('Private PDK archive transfer failed')
  }
}
