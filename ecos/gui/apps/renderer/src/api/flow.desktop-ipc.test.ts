import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { CMDEnum, InfoEnum, StepEnum } from './type'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
    writable: true,
  })
}

function restoreWindow() {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
    return
  }

  delete (globalThis as { window?: unknown }).window
}

describe('flow API desktop bridge payloads', () => {
  afterEach(() => {
    restoreWindow()
    vi.resetModules()
  })

  it('sends structured-cloneable requests when flow command data is reactive', async () => {
    const execute = vi.fn(async (request: unknown) => {
      expect(() => structuredClone(request)).not.toThrow()
      return {
        cmd: 'run_step',
        data: {},
        message: ['ok'],
        ok: true,
        response: 'success',
      }
    })

    setWindow({
      ecosDesktop: {
        cli: {
          cancel: vi.fn(),
          execute,
        },
      },
    })

    const { getInfoApi, rtl2gdsApi, runStepApi } = await import('./flow')

    await runStepApi(reactive({
      cmd: CMDEnum.run_step,
      data: {
        directory: '/work/demo',
        rerun: false,
        step: StepEnum.PLACEMENT,
      },
    }))
    await rtl2gdsApi(reactive({
      cmd: CMDEnum.rtl2gds,
      data: {
        directory: '/work/demo',
        rerun: true,
      },
    }))
    await getInfoApi(reactive({
      cmd: CMDEnum.get_info,
      data: {
        id: InfoEnum.layout,
        step: StepEnum.ROUTING,
      },
    }))

    expect(execute).toHaveBeenCalledTimes(3)
    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cmd: 'run_step',
      data: {
        directory: '/work/demo',
        rerun: false,
        step: StepEnum.PLACEMENT,
      },
    }))
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cmd: 'rtl2gds',
      data: {
        directory: '/work/demo',
        rerun: true,
      },
    }))
    expect(execute).toHaveBeenNthCalledWith(3, expect.objectContaining({
      cmd: 'get_info',
      data: {
        id: InfoEnum.layout,
        step: StepEnum.ROUTING,
      },
    }))
  })
})
