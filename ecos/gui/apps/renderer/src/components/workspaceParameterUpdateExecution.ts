import type {
  DesktopAgentWorkspaceParameterUpdateContract,
  DesktopAgentExecutionContract,
  EccWorkspaceConfigurationUpdateRequest,
} from '@ecos-studio/shared'

export function confirmedExecutionToken(
  optionValue: string,
  contract: DesktopAgentExecutionContract | undefined,
): string | undefined {
  return optionValue === '1' ? contract?.confirmation_token : undefined
}

interface WorkspaceParameterUpdateDependencies {
  commandId(): string
  currentWorkspace: string
  errorMessage(error: unknown): string
  initialRevision: number | undefined
  invalidate(): void
  onFailure(reason: string): void
  onReportFailure(reason: string): void
  report(status: 'succeeded' | 'failed', error: string): Promise<void>
  updateConfiguration(request: EccWorkspaceConfigurationUpdateRequest): Promise<unknown>
  updateRevision(revision: number): void
  workspaceHandle: string
}

function normalizedWorkspace(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function resultRevision(result: unknown, operation: string): number {
  if (
    !result ||
    typeof result !== 'object' ||
    !('workspaceRevision' in result) ||
    typeof result.workspaceRevision !== 'number'
  ) {
    throw new Error(`${operation} did not return a Revision.`)
  }
  return result.workspaceRevision
}

export async function executeConfirmedWorkspaceParameterUpdate(
  contract: DesktopAgentWorkspaceParameterUpdateContract,
  dependencies: WorkspaceParameterUpdateDependencies,
): Promise<void> {
  let committed = false
  try {
    if (
      normalizedWorkspace(dependencies.currentWorkspace) !==
      normalizedWorkspace(contract.workspace)
    ) {
      throw new Error('The parameter update targets a workspace that is not open.')
    }
    const initialRevision = dependencies.initialRevision
    if (
      typeof initialRevision !== 'number' ||
      !Number.isInteger(initialRevision) ||
      initialRevision < 1
    ) {
      throw new Error('Workspace Revision is unavailable.')
    }
    if (contract.step_configurations.length) {
      throw new Error('Legacy Step Options are no longer supported.')
    }
    let workspaceRevision = initialRevision
    if (Object.keys(contract.workspace_parameters).length) {
      workspaceRevision = resultRevision(
        await dependencies.updateConfiguration({
          commandId: dependencies.commandId(),
          configuration: {
            design: {},
            parameters: contract.workspace_parameters,
            pdk: {},
          },
          expectedWorkspaceRevision: workspaceRevision,
          workspaceHandle: dependencies.workspaceHandle,
        }),
        'Workspace parameter update',
      )
      committed = true
      dependencies.updateRevision(workspaceRevision)
    }
    dependencies.invalidate()
    await dependencies.report('succeeded', '')
  } catch (error) {
    if (committed) dependencies.invalidate()
    const detail = dependencies.errorMessage(error)
    const reason = committed ? `Parameter update partially applied: ${detail}` : detail
    dependencies.onFailure(reason)
    try {
      await dependencies.report('failed', reason)
    } catch {
      dependencies.onReportFailure(reason)
    }
  }
}
