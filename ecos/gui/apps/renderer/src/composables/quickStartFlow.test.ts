import { describe, expect, it, vi } from 'vitest'
import type {
  DesktopApi,
  DesignRuntimeEvent,
  EccRuntimeOperation,
} from '@ecos-studio/shared'
import { runQuickStartFlow } from './quickStartFlow'

function operation(state: EccRuntimeOperation['state'] = 'running'): EccRuntimeOperation {
  return {
    awaitingEventId: null,
    createdAt: 0,
    currentStep: 'Harden',
    currentTool: 'ecc',
    error: null,
    kind: 'flow',
    operationId: 'op-1',
    origin: 'gui',
    rerun: false,
    result: null,
    state,
    step: '',
    updatedAt: 1,
    workspaceId: 'workspace-1',
  }
}

function stage(
  type: 'step.started' | 'step.completed',
  step: string,
  state = 'Success',
  operationId = 'op-1',
): DesignRuntimeEvent {
  return {
    designTool: 'backend',
    type: 'runtime.protocol',
    workspaceDirectory: '/runs/gcd',
    event: {
      eventId: `${operationId}-${type}-${step}`,
      operationId,
      origin: 'gui',
      sequence: 1,
      timestamp: 1,
      type,
      workspaceId: 'workspace-1',
      payload: { step, state },
    },
  }
}

function fixture() {
  let listener: (event: DesignRuntimeEvent) => void = () => undefined
  const unsubscribe = vi.fn()
  const waitForOperation = vi.fn(async () => operation('succeeded'))
  const cancel = vi.fn(async () => operation('cancelled'))
  const api = {
    runtime: {
      events: {
        onEvent: vi.fn((callback) => {
          listener = callback
          return unsubscribe
        }),
      },
    },
    ecc: { runtime: { waitForOperation, cancel } },
  } as unknown as DesktopApi
  const narrate = vi.fn()
  const onStarted = vi.fn(async () => undefined)
  const start = vi.fn(async () => operation())
  const options = {
    api,
    workspaceHandle: 'handle-1',
    workspacePath: '/runs/gcd',
    narrate,
    start,
    onStarted,
  }
  return {
    options,
    emit: (event: DesignRuntimeEvent) => listener(event),
    unsubscribe,
    waitForOperation,
    cancel,
  }
}

describe('Quick Start flow narration', () => {
  it('subscribes before launch, scopes and deduplicates stage events, and waits for terminal evidence', async () => {
    const { options, emit, unsubscribe, waitForOperation } = fixture()
    options.start.mockImplementation(async () => {
      emit(stage('step.started', 'CTS'))
      emit(stage('step.started', 'CTS'))
      emit(stage('step.started', 'route', 'Success', 'other-operation'))
      return operation()
    })
    waitForOperation.mockImplementation(async () => {
      expect(options.onStarted).toHaveBeenCalledOnce()
      emit(stage('step.completed', 'CTS'))
      emit(stage('step.started', 'Timing optimization'))
      emit(stage('step.completed', 'Timing optimization'))
      return operation('succeeded')
    })
    const result = await runQuickStartFlow(options)
    expect(result).toEqual({
      workspacePath: '/runs/gcd',
      operationId: 'op-1',
      state: 'succeeded',
    })
    expect(options.narrate.mock.calls.flat()).toEqual([
      '正在进行 CTS（时钟树综合）：构建时钟分配网络，控制时钟偏斜和延迟。',
      'CTS（时钟树综合）执行完成。',
      '正在进行 Timing optimization（时序优化）：调整单元尺寸以改善时序，并对调整后的布局进行合法化。',
      'Timing optimization（时序优化）执行完成。',
    ])
    expect(waitForOperation).toHaveBeenCalledWith({
      workspaceHandle: 'handle-1',
      operationId: 'op-1',
    })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'cancelled'] as const)(
    'returns %s without claiming success and distinguishes skipped steps',
    async (state) => {
      const { options, emit, waitForOperation, unsubscribe } = fixture()
      waitForOperation.mockImplementation(async () => {
        emit(stage('step.completed', 'Synthesis', 'Skipped'))
        emit(stage('step.completed', 'route', 'Imcomplete'))
        return operation(state)
      })
      expect((await runQuickStartFlow(options)).state).toBe(state)
      expect(options.narrate.mock.calls.flat()).toEqual([
        'Synthesis（逻辑综合）复用已有结果，本次未重新执行。',
        'route（布线）未成功完成。',
      ])
      expect(unsubscribe).toHaveBeenCalledOnce()
    },
  )

  it('ignores other workspaces and removes subscriptions when launch fails', async () => {
    const { options, emit, unsubscribe } = fixture()
    options.start.mockImplementation(async () => {
      emit({ ...stage('step.started', 'CTS'), workspaceDirectory: '/runs/other' })
      throw new Error('launch failed')
    })
    await expect(runQuickStartFlow(options)).rejects.toThrow('launch failed')
    expect(options.narrate).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('rejects a nonterminal or mismatched wait result', async () => {
    const { options, waitForOperation } = fixture()
    waitForOperation.mockResolvedValue(operation('running'))
    await expect(runQuickStartFlow(options)).rejects.toThrow('terminal')
    waitForOperation.mockResolvedValue({
      ...operation('succeeded'),
      operationId: 'other',
    })
    await expect(runQuickStartFlow(options)).rejects.toThrow('terminal')
  })

  it('cancels the bound operation and still waits for its terminal result', async () => {
    const { options, cancel, waitForOperation } = fixture()
    const controller = new AbortController()
    options.start.mockImplementation(async () => {
      controller.abort()
      return operation()
    })
    waitForOperation.mockResolvedValue(operation('cancelled'))
    expect(
      (await runQuickStartFlow({ ...options, signal: controller.signal })).state,
    ).toBe('cancelled')
    expect(cancel).toHaveBeenCalledExactlyOnceWith({
      workspaceHandle: 'handle-1',
      operationId: 'op-1',
    })
    expect(waitForOperation).toHaveBeenCalledOnce()
  })
})
