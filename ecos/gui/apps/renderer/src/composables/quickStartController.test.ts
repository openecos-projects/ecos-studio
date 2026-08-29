import { describe, expect, it, vi } from 'vitest'
import {
  runQuickStartWorkflow,
  type QuickStartWorkflowHost,
} from './quickStartController'

function host(overrides: Partial<QuickStartWorkflowHost> = {}): QuickStartWorkflowHost {
  return {
    appVersion: '0.1.0',
    createProject: vi.fn(async () => ({ id: 'project-1', name: 'gcd' })),
    createWorkspace: vi.fn(async () => ({ id: 'ws_0001', path: '/quick/gcd/ws_0001' })),
    handoff: vi.fn(async () => undefined),
    listResources: vi.fn(async () => ({
      design: { id: 'example:gcd', path: '/resources/gcd/gcd.v', version: '1.0.0' },
      mpc: { id: 'mpc:mpc-frame', version: '0.1.0' },
      pdk: { id: 'pdk:ics55', path: '/resources/ics55', version: '1.0.0' },
    })),
    navigate: vi.fn(async () => undefined),
    startFlow: vi.fn(async () => ({ id: 'operation-1' })),
    ...overrides,
  }
}

describe('quick start controller', () => {
  it('runs the approved path in order and exposes lifecycle projections', async () => {
    const calls: string[] = []
    const controller = host()
    vi.mocked(controller.navigate).mockImplementation(async () => {
      calls.push('navigate')
    })
    vi.mocked(controller.createProject).mockImplementation(async () => {
      calls.push('createProject')
      return { id: 'project-1', name: 'gcd' }
    })
    vi.mocked(controller.createWorkspace).mockImplementation(async () => {
      calls.push('createWorkspace')
      return { id: 'ws_0001', path: '/quick/gcd/ws_0001' }
    })
    vi.mocked(controller.handoff).mockImplementation(async () => {
      calls.push('handoff')
    })
    vi.mocked(controller.startFlow).mockImplementation(async () => {
      calls.push('startFlow')
      return { id: 'operation-1' }
    })
    const events: string[] = []

    const result = await runQuickStartWorkflow(controller, (event) => {
      events.push(`${event.stepId}:${event.status}`)
    })

    expect(calls).toEqual([
      'navigate',
      'createProject',
      'createWorkspace',
      'handoff',
      'startFlow',
    ])
    expect(result.bindings).toMatchObject({
      project: { id: 'project-1', name: 'gcd' },
      workspace: { id: 'ws_0001', path: '/quick/gcd/ws_0001' },
    })
    expect(events).toEqual([
      'preflight:pending',
      'preflight:running',
      'preflight:completed',
      'project-management:pending',
      'project-management:running',
      'project-management:completed',
      'create-project:pending',
      'create-project:running',
      'create-project:completed',
      'workspace-setup:pending',
      'workspace-setup:running',
      'workspace-setup:completed',
      'handoff:pending',
      'handoff:running',
      'handoff:completed',
      'run-flow:pending',
      'run-flow:running',
      'run-flow:completed',
    ])
  })

  it('fails before mutation when a required resource is unavailable', async () => {
    const controller = host({
      listResources: vi.fn(async () => ({
        design: null,
        diagnostics: ['GCD local fallback was not found.'],
        mpc: { id: 'mpc:mpc-frame', version: '0.1.0' },
        pdk: { id: 'pdk:ics55', path: '/resources/ics55', version: '1.0.0' },
      })),
    })

    await expect(runQuickStartWorkflow(controller)).rejects.toThrow(
      /GCD local fallback was not found/,
    )
    expect(controller.createProject).not.toHaveBeenCalled()
  })

  it('honors setup cancellation before the next mutation', async () => {
    const abort = new AbortController()
    const controller = host({
      navigate: vi.fn(async () => abort.abort()),
    })

    await expect(
      runQuickStartWorkflow(controller, undefined, abort.signal),
    ).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(controller.createProject).not.toHaveBeenCalled()
  })
})
