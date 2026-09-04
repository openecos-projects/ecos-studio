import { describe, expect, it, vi } from 'vitest'
import {
  confirmedExecutionToken,
  executeConfirmedWorkspaceParameterUpdate,
} from './workspaceParameterUpdateExecution'

const contract = {
  parameter_patch: [
    { knob_id: 'design.frequency_max', value: 250 },
    { knob_id: 'cts.skew_bound', value: 0.08 },
  ],
  schema_version: 'flow-agent.workspace_parameter_update_contract.v3' as const,
  step_configurations: [
    { step_id: 'CTS', options: { skew_bound: 0.08 } },
    { step_id: 'route', options: { RT: { '-thread_number': 8 } } },
  ],
  update_id: 'update-1',
  workspace: '/runs/gcd',
  workspace_parameters: { frequency_max: 250 },
}

function dependencies() {
  return {
    commandId: vi
      .fn()
      .mockReturnValueOnce('command-1')
      .mockReturnValueOnce('command-2')
      .mockReturnValueOnce('command-3'),
    currentWorkspace: '/runs/gcd/',
    errorMessage: (error: unknown) =>
      error instanceof Error ? error.message : String(error),
    initialRevision: 4,
    invalidate: vi.fn(),
    onFailure: vi.fn(),
    onReportFailure: vi.fn(),
    report: vi.fn().mockResolvedValue(undefined),
    updateConfiguration: vi.fn().mockResolvedValue({ workspaceRevision: 5 }),
    updateRevision: vi.fn(),
    updateStepConfiguration: vi
      .fn()
      .mockResolvedValueOnce({ workspaceRevision: 6 })
      .mockResolvedValueOnce({ workspaceRevision: 7 }),
    workspaceHandle: 'workspace-1',
  }
}

describe('executeConfirmedWorkspaceParameterUpdate', () => {
  it('returns an Electron confirmation token only for the Confirm choice', () => {
    const executionContract = {
      confirmation_token: 'confirmation-1',
      fields: [],
      schema_version: 'flow-agent.resolved_execution_contract.v1' as const,
      title: 'Confirm',
    }

    expect(confirmedExecutionToken('1', executionContract)).toBe('confirmation-1')
    expect(confirmedExecutionToken('2', executionContract)).toBeUndefined()
  })

  it('chains Revisions, invalidates resources, and reports success', async () => {
    const deps = dependencies()

    await executeConfirmedWorkspaceParameterUpdate(contract, deps)

    expect(deps.updateConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ expectedWorkspaceRevision: 4 }),
    )
    expect(
      deps.updateStepConfiguration.mock.calls.map(
        ([request]) => request.expectedWorkspaceRevision,
      ),
    ).toEqual([5, 6])
    expect(deps.updateRevision.mock.calls.map(([revision]) => revision)).toEqual([
      5, 6, 7,
    ])
    expect(deps.invalidate).toHaveBeenCalledOnce()
    expect(deps.report).toHaveBeenLastCalledWith('succeeded', '')
  })

  it('invalidates cached reads and reports partial success after a later failure', async () => {
    const deps = dependencies()
    deps.updateStepConfiguration.mockReset()
    deps.updateStepConfiguration.mockRejectedValueOnce(new Error('ECC rejected CTS'))

    await executeConfirmedWorkspaceParameterUpdate(contract, deps)

    expect(deps.updateRevision).toHaveBeenCalledWith(5)
    expect(deps.invalidate).toHaveBeenCalledOnce()
    expect(deps.onFailure).toHaveBeenCalledWith(
      'Parameter update partially applied: ECC rejected CTS',
    )
    expect(deps.report).toHaveBeenLastCalledWith(
      'failed',
      'Parameter update partially applied: ECC rejected CTS',
    )
  })
})
