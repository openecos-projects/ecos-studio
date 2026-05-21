import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StateEnum, StepEnum } from '@/api/type'

const {
  ensureTauri,
  ensureApiReady,
  showToast,
  triggerStepRefresh,
  runStepApi,
  rtl2gdsApi,
} = vi.hoisted(() => ({
  ensureTauri: vi.fn(() => false),
  ensureApiReady: vi.fn(() => Promise.resolve(true)),
  showToast: vi.fn(),
  triggerStepRefresh: vi.fn(),
  runStepApi: vi.fn(),
  rtl2gdsApi: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: {
      step: StepEnum.FLOORPLAN,
    },
  }),
}))

vi.mock('./useTauri', () => ({
  useTauri: () => ({
    isInTauri: false,
    ensureTauri,
  }),
}))

vi.mock('./useWorkspace', () => ({
  useWorkspace: () => ({
    ensureApiReady,
    showToast,
    triggerStepRefresh,
  }),
}))

vi.mock('@/api/flow', () => ({
  runStepApi,
  rtl2gdsApi,
}))

import { flowExecutionActive, useFlowRunner } from './useFlowRunner'

describe('useFlowRunner desktop-only guard', () => {
  beforeEach(() => {
    ensureTauri.mockReset()
    ensureTauri.mockReturnValue(false)
    ensureApiReady.mockReset()
    ensureApiReady.mockResolvedValue(true)
    showToast.mockReset()
    triggerStepRefresh.mockReset()
    runStepApi.mockReset()
    rtl2gdsApi.mockReset()
    flowExecutionActive.value = false
  })

  it('shows a toast when running a single step outside the desktop runtime', async () => {
    const { runFlow } = useFlowRunner()

    const result = await runFlow()

    expect(ensureTauri).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Desktop App Required',
      detail: 'Flow execution is only available in the desktop app.',
      life: 5000,
    })
    expect(runStepApi).not.toHaveBeenCalled()
    expect(ensureApiReady).not.toHaveBeenCalled()
    expect(triggerStepRefresh).not.toHaveBeenCalled()
    expect(result).toEqual({
      step: StepEnum.FLOORPLAN,
      state: StateEnum.Invalid,
    })
  })

  it('shows a toast when running the full flow outside the desktop runtime', async () => {
    const { runAllFlow } = useFlowRunner()

    const result = await runAllFlow()

    expect(ensureTauri).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith({
      severity: 'warn',
      summary: 'Desktop App Required',
      detail: 'Flow execution is only available in the desktop app.',
      life: 5000,
    })
    expect(rtl2gdsApi).not.toHaveBeenCalled()
    expect(ensureApiReady).not.toHaveBeenCalled()
    expect(triggerStepRefresh).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('does not trigger a refresh after the full flow API returns because runtime events drive refresh', async () => {
    ensureTauri.mockReturnValue(true)
    rtl2gdsApi.mockResolvedValue({
      response: 'success',
      data: { rerun: false },
      message: ['done'],
    })

    const { runAllFlow } = useFlowRunner()

    await expect(runAllFlow()).resolves.toEqual({ rerun: false })

    expect(triggerStepRefresh).not.toHaveBeenCalled()
  })

  it('does not mark the full flow running when the runtime bridge is unavailable', async () => {
    ensureTauri.mockReturnValue(true)
    ensureApiReady.mockResolvedValue(false)

    const { runAllFlow, isRunning } = useFlowRunner()

    await expect(runAllFlow()).resolves.toBeNull()

    expect(ensureApiReady).toHaveBeenCalledTimes(1)
    expect(rtl2gdsApi).not.toHaveBeenCalled()
    expect(triggerStepRefresh).not.toHaveBeenCalled()
    expect(isRunning.value).toBe(false)
  })
})
