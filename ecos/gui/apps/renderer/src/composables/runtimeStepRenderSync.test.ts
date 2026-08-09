import { describe, expect, it, vi } from 'vitest'

const getWorkspaceResourceIndexApi = vi.hoisted(() => vi.fn())

vi.mock('@/api/workspaceResources', () => ({ getWorkspaceResourceIndexApi }))

import {
  finishRuntimeStepRender,
  registerRuntimeStepRenderTask,
} from './runtimeStepRenderSync'
import type { RuntimeStepRenderContext } from './runtimeStepRenderSync'

describe('runtimeStepRenderSync', () => {
  it('coalesces every mounted view resource-index request for one commit', async () => {
    getWorkspaceResourceIndexApi.mockResolvedValue({ flow: { steps: [] } })
    const first = vi.fn(async (commit: RuntimeStepRenderContext) => {
      await commit.resourceIndex()
    })
    const second = vi.fn(async (commit: RuntimeStepRenderContext) => {
      await commit.resourceIndex()
    })
    const unregisterFirst = registerRuntimeStepRenderTask(first)
    const unregisterSecond = registerRuntimeStepRenderTask(second)

    await finishRuntimeStepRender({
      eventId: 'workspace-1:3',
      operationId: 'operation-1',
      step: 'floorplan',
      stepCommitId: 'operation-1:step:3',
    })

    expect(getWorkspaceResourceIndexApi).toHaveBeenCalledTimes(1)
    unregisterFirst()
    unregisterSecond()
  })

  it('waits for every registered step view refresh before resolving the commit', async () => {
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)
    const unregisterFirst = registerRuntimeStepRenderTask(first)
    const unregisterSecond = registerRuntimeStepRenderTask(second)

    await finishRuntimeStepRender({
      eventId: 'workspace-1:4',
      operationId: 'operation-1',
      step: 'place',
      stepCommitId: 'operation-1:step:4',
      workspaceRevision: 4,
    })

    expect(first).toHaveBeenCalledWith(expect.objectContaining({ step: 'place' }))
    expect(second).toHaveBeenCalledWith(
      expect.objectContaining({ stepCommitId: 'operation-1:step:4' }),
    )
    unregisterFirst()
    unregisterSecond()
  })

  it('keeps the ACK path available when one optional view refresh fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unregister = registerRuntimeStepRenderTask(async () => {
      throw new Error('NFS preview unavailable')
    })

    await expect(
      finishRuntimeStepRender({
        eventId: 'workspace-1:5',
        operationId: 'operation-1',
        step: 'route',
        stepCommitId: 'operation-1:step:5',
      }),
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
    unregister()
    warn.mockRestore()
  })
})
