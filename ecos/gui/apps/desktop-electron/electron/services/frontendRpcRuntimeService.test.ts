import type { EccRpcRuntimeService } from './eccRpc/runtimeService'
import { describe, expect, it, vi } from 'vitest'

import { FrontendRpcRuntimeService } from './frontendRpcRuntimeService'

function createRuntime() {
  return {
    activeWorkspaceDirectory: '/work/frontend',
    callRuntime: vi.fn().mockResolvedValue({}),
    closeWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    createWorkspacePayload: vi.fn().mockResolvedValue({
      directory: '/work/frontend',
      workspaceHandle: 'handle-1',
    }),
    isWorkspaceRuntimeActive: vi.fn().mockReturnValue(true),
    onEvent: vi.fn().mockReturnValue(() => undefined),
    openWorkspace: vi.fn().mockResolvedValue({
      directory: '/work/frontend',
      workspaceHandle: 'handle-1',
    }),
    rpcPing: vi.fn().mockResolvedValue({ ok: true }),
    rpcShutdown: vi.fn().mockResolvedValue({ ok: true }),
    runFlow: vi.fn().mockResolvedValue({ rerun: false }),
    runStepPayload: vi.fn().mockResolvedValue({ state: 'Success', step: 'sim' }),
    workspaceHome: vi.fn().mockResolvedValue({ path: '/work/frontend/home/home.json' }),
    workspaceInfo: vi.fn().mockResolvedValue({ id: 'subflow', info: {}, step: 'sim' }),
  }
}

describe('FrontendRpcRuntimeService', () => {
  it('maps frontend extensions and workspace methods to the shared RPC runtime', async () => {
    const runtime = createRuntime()
    const service = new FrontendRpcRuntimeService({
      runtime: runtime as unknown as EccRpcRuntimeService,
    })

    await service.catalogList()
    await service.validateConfig({ core_id: 'custom-filelist' })
    await service.createWorkspace({ directory: '/work/frontend' })
    await service.runStep('handle-1', { rerun: true, step: 'sim' })

    expect(runtime.callRuntime).toHaveBeenNthCalledWith(1, 'frontend.catalog')
    expect(runtime.callRuntime).toHaveBeenNthCalledWith(2, 'frontend.validate_config', {
      core_id: 'custom-filelist',
    })
    expect(runtime.createWorkspacePayload).toHaveBeenCalledWith({
      directory: '/work/frontend',
    })
    expect(runtime.runStepPayload).toHaveBeenCalledWith('handle-1', {
      rerun: true,
      step: 'sim',
    })
    expect(service.activeWorkspaceDirectory).toBe('/work/frontend')
    expect(service.isWorkspaceRuntimeActive('/work/frontend')).toBe(true)
  })
})
