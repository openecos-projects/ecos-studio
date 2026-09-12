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

  it('keeps event refresh available when one optional view refresh fails', async () => {
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

  it('serializes refreshes for commits from the same operation', async () => {
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const order: string[] = []
    const unregister = registerRuntimeStepRenderTask(async (commit) => {
      order.push(commit.step)
      if (commit.step === 'Synthesis') await firstReleased
    })

    const first = finishRuntimeStepRender({
      eventId: 'workspace-1:6',
      operationId: 'operation-1',
      step: 'Synthesis',
      stepCommitId: 'operation-1:step:6',
    })
    const second = finishRuntimeStepRender({
      eventId: 'workspace-1:7',
      operationId: 'operation-1',
      step: 'preFloorplan',
      stepCommitId: 'operation-1:step:7',
    })

    await vi.waitFor(() => expect(order).toEqual(['Synthesis']))
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['Synthesis', 'preFloorplan'])
    unregister()
  })

  it('coalesces pending commits for one workspace to the newest revision', async () => {
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const steps: string[] = []
    const unregister = registerRuntimeStepRenderTask(async (commit) => {
      steps.push(commit.step)
      if (commit.step === 'Synthesis') await firstReleased
    })

    const first = finishRuntimeStepRender({
      eventId: 'workspace-1:8',
      operationId: 'operation-1',
      workspaceHandle: '/work/a',
      step: 'Synthesis',
      stepCommitId: 'operation-1:step:8',
      workspaceRevision: 8,
    })
    const second = finishRuntimeStepRender({
      eventId: 'workspace-1:9',
      operationId: 'operation-1',
      workspaceHandle: '/work/a',
      step: 'preFloorplan',
      stepCommitId: 'operation-1:step:9',
      workspaceRevision: 9,
    })
    const third = finishRuntimeStepRender({
      eventId: 'workspace-1:10',
      operationId: 'operation-2',
      workspaceHandle: '/work/a',
      step: 'macroPlacement',
      stepCommitId: 'operation-2:step:10',
      workspaceRevision: 10,
    })
    const late = finishRuntimeStepRender({
      eventId: 'workspace-1:9-late',
      operationId: 'operation-1',
      workspaceHandle: '/work/a',
      step: 'preFloorplan',
      stepCommitId: 'operation-1:step:9-late',
      workspaceRevision: 9,
    })

    await vi.waitFor(() => expect(steps).toEqual(['Synthesis']))
    releaseFirst()
    await Promise.all([first, second, third, late])
    expect(steps).toEqual(['Synthesis', 'macroPlacement'])
    unregister()
  })

  it('releases queued callers when scheduling a refresh throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const unregister = registerRuntimeStepRenderTask(() => {
      throw new Error('refresh scheduler failed')
    })

    await expect(
      finishRuntimeStepRender({
        eventId: 'workspace-1:11',
        operationId: 'operation-1',
        step: 'route',
        stepCommitId: 'operation-1:step:11',
      }),
    ).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalled()
    unregister()
    warn.mockRestore()
  })
})
