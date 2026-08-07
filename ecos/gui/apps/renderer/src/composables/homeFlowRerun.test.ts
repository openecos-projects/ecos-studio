import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerHomeWorkspaceRerun, rerunHomeWorkspace } from './homeFlowRerun'

describe('home workspace rerun registration', () => {
  let unregister: (() => void) | undefined

  afterEach(() => {
    unregister?.()
    unregister = undefined
  })

  it('runs the App-owned workspace replacement handler', async () => {
    const handler = vi.fn(async () => true)
    unregister = registerHomeWorkspaceRerun(handler)

    await expect(rerunHomeWorkspace()).resolves.toBe(true)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('rejects requests after the App-owned handler is removed', async () => {
    unregister = registerHomeWorkspaceRerun(async () => true)
    unregister()
    unregister = undefined

    await expect(rerunHomeWorkspace()).rejects.toThrow(
      'Workspace rerun is not available.',
    )
  })
})
