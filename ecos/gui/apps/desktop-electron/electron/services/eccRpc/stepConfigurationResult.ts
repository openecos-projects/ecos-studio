import type { EccWorkspaceStepConfigurationReadResult } from '@ecos-studio/shared'

export function mapStepConfigurationReadResult(
  result: unknown,
): EccWorkspaceStepConfigurationReadResult {
  if (!isRecord(result) || typeof result.step !== 'string') {
    return invalidResult('')
  }
  if (result.status === 'available') {
    if (
      !hasWorkspaceIdentity(result) ||
      typeof result.stepId !== 'string' ||
      !Array.isArray(result.parameters) ||
      !result.parameters.every(isPublicParameterRecord)
    ) {
      return invalidResult(result.step)
    }
    return result as EccWorkspaceStepConfigurationReadResult
  }
  if (
    (result.status === 'missing' || result.status === 'unavailable') &&
    typeof result.reason === 'string'
  ) {
    if (
      result.reason === 'step_configuration_unavailable' &&
      !hasWorkspaceIdentity(result)
    ) {
      return invalidResult(result.step)
    }
    if (
      result.status === 'unavailable' &&
      result.reason === 'step_configuration_unavailable'
    ) {
      return { ...result, status: 'missing' } as EccWorkspaceStepConfigurationReadResult
    }
    return result as EccWorkspaceStepConfigurationReadResult
  }
  return invalidResult(result.step)
}

function hasWorkspaceIdentity(result: Record<string, unknown>): boolean {
  return (
    typeof result.workspaceId === 'string' &&
    typeof result.workspaceRevision === 'number' &&
    Number.isInteger(result.workspaceRevision) &&
    result.workspaceRevision >= 1
  )
}

function isPublicParameterRecord(parameter: unknown): boolean {
  return (
    isRecord(parameter) &&
    typeof parameter.param === 'string' &&
    typeof parameter.type === 'string' &&
    typeof parameter.applies === 'string' &&
    typeof parameter.description === 'string' &&
    'value' in parameter &&
    'default' in parameter
  )
}

function invalidResult(step: string): EccWorkspaceStepConfigurationReadResult {
  return {
    reason: 'step_configuration_invalid_response',
    status: 'unavailable',
    step,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
