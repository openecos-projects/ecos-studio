import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResourceStalenessItem } from '@ecos-studio/shared'

import {
  confirmStaleResourceRerun,
  useResourceStalenessGuard,
} from './useResourceStalenessGuard'

const STALE_ITEM: ResourceStalenessItem = {
  id: 'tool:yosys',
  display_name: 'Yosys',
  installed_version: '0.61',
  latest_version: '0.62',
  update_kind: 'version',
}

function makeStalenessError(resources: ResourceStalenessItem[] = [STALE_ITEM]) {
  return { code: 'RESOURCE_UPDATE_AVAILABLE', details: { resources } }
}

function makeRequest(retry: (allowStale: boolean) => Promise<void>) {
  return {
    resources: [STALE_ITEM],
    runLabel: 'full flow',
    retry,
  }
}

describe('useResourceStalenessGuard', () => {
  beforeEach(() => {
    useResourceStalenessGuard().dismiss()
  })

  it('exposes a requested confirmation', () => {
    const guard = useResourceStalenessGuard()
    expect(guard.pendingRequest.value).toBeNull()

    guard.requestStalenessConfirmation(makeRequest(vi.fn(async () => undefined)))

    expect(guard.pendingRequest.value).toMatchObject({
      resources: [STALE_ITEM],
      runLabel: 'full flow',
    })
  })

  it('dismiss clears the pending request', () => {
    const guard = useResourceStalenessGuard()
    guard.requestStalenessConfirmation(makeRequest(vi.fn(async () => undefined)))

    guard.dismiss()

    expect(guard.pendingRequest.value).toBeNull()
  })

  it('runAnyway retries with allowStale and clears the request', async () => {
    const guard = useResourceStalenessGuard()
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    guard.requestStalenessConfirmation(makeRequest(retry))

    await guard.runAnyway()

    expect(retry).toHaveBeenCalledWith(true)
    expect(guard.pendingRequest.value).toBeNull()
  })

  it('retryAfterUpdates retries without allowStale and clears the request', async () => {
    const guard = useResourceStalenessGuard()
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    guard.requestStalenessConfirmation(makeRequest(retry))

    await guard.retryAfterUpdates()

    expect(retry).toHaveBeenCalledWith(false)
    expect(guard.pendingRequest.value).toBeNull()
  })

  it('keeps a replacement request when the retry trips the guard again', async () => {
    const guard = useResourceStalenessGuard()
    const replacementRetry = vi.fn(async (_allowStale: boolean) => undefined)
    const retry = vi.fn(async (_allowStale: boolean) => {
      guard.requestStalenessConfirmation({
        resources: [STALE_ITEM],
        runLabel: 'full flow',
        retry: replacementRetry,
      })
    })
    guard.requestStalenessConfirmation(makeRequest(retry))

    await guard.runAnyway()

    expect(retry).toHaveBeenCalledWith(true)
    expect(guard.pendingRequest.value?.retry).toBe(replacementRetry)
  })

  it('replaces an older pending request with a newer one', async () => {
    const guard = useResourceStalenessGuard()
    const firstRetry = vi.fn(async (_allowStale: boolean) => undefined)
    const secondRetry = vi.fn(async (_allowStale: boolean) => undefined)
    guard.requestStalenessConfirmation(makeRequest(firstRetry))
    guard.requestStalenessConfirmation({
      resources: [STALE_ITEM],
      runLabel: 'Place step',
      retry: secondRetry,
    })

    await guard.runAnyway()

    expect(secondRetry).toHaveBeenCalledWith(true)
    expect(firstRetry).not.toHaveBeenCalled()
  })

  it('does nothing without a pending request', async () => {
    const guard = useResourceStalenessGuard()

    await guard.runAnyway()
    await guard.retryAfterUpdates()

    expect(guard.pendingRequest.value).toBeNull()
  })
})

describe('confirmStaleResourceRerun', () => {
  beforeEach(() => {
    useResourceStalenessGuard().dismiss()
  })

  it('ignores non-staleness errors', () => {
    const retry = vi.fn(async (_allowStale: boolean) => undefined)

    const intercepted = confirmStaleResourceRerun(new Error('boom'), 'lint step', retry)

    expect(intercepted).toBe(false)
    expect(useResourceStalenessGuard().pendingRequest.value).toBeNull()
  })

  it('queues a confirmation carrying the error payload resources', () => {
    const retry = vi.fn(async (_allowStale: boolean) => undefined)

    const intercepted = confirmStaleResourceRerun(
      makeStalenessError(),
      'lint step',
      retry,
    )

    expect(intercepted).toBe(true)
    expect(useResourceStalenessGuard().pendingRequest.value).toMatchObject({
      resources: [STALE_ITEM],
      runLabel: 'lint step',
    })
  })

  it('queues an empty resource list when the error carries no details', () => {
    const intercepted = confirmStaleResourceRerun(
      { code: 'RESOURCE_UPDATE_AVAILABLE' },
      'lint step',
      vi.fn(async (_allowStale: boolean) => undefined),
    )

    expect(intercepted).toBe(true)
    expect(useResourceStalenessGuard().pendingRequest.value?.resources).toEqual([])
  })

  it('routes the user decision through the provided retry', async () => {
    const guard = useResourceStalenessGuard()
    const retry = vi.fn(async (_allowStale: boolean) => undefined)
    confirmStaleResourceRerun(makeStalenessError(), 'lint step', retry)

    await guard.runAnyway()

    expect(retry).toHaveBeenCalledWith(true)
    expect(guard.pendingRequest.value).toBeNull()
  })
})
