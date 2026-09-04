import { randomUUID } from 'node:crypto'

import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'

export interface WorkspaceRerunRuntime {
  startFlowOperation(request: {
    expectedWorkspaceRevision: number
    idempotencyKey: string
    rerun: boolean
    workspaceHandle: string
  }): Promise<{ operationId: string }>
  startStepOperation(request: {
    expectedWorkspaceRevision: number
    idempotencyKey: string
    rerun: boolean
    step: string
    workspaceHandle: string
  }): Promise<{ operationId: string }>
  updateWorkspaceConfiguration(request: {
    commandId: string
    configuration: {
      design: Record<string, never>
      parameters: Record<string, unknown>
      pdk: Record<string, never>
    }
    expectedWorkspaceRevision: number
    workspaceHandle: string
  }): Promise<{ workspaceRevision: number }>
  updateWorkspaceStepConfiguration(request: {
    commandId: string
    expectedWorkspaceRevision: number
    options: Record<string, unknown>
    stepId: string
    workspaceHandle: string
  }): Promise<{ workspaceRevision: number }>
  waitForOperation(request: {
    operationId: string
    workspaceHandle: string
  }): Promise<{ error: { message: string } | null; state: string }>
}

export function isWorkspaceRerunParameterValue(value: unknown): boolean {
  if (typeof value === 'boolean') return true
  if (typeof value === 'string') return isSafeParameterString(value)
  if (typeof value === 'number') return Number.isFinite(value)
  if (!Array.isArray(value) || value.length > 64) return false
  return value.every(
    (item) =>
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && isSafeParameterString(item)),
  )
}

export function hasValidWorkspaceRerunDomainUpdates(
  contract: DesktopAgentWorkspaceRerunContract,
  flowSteps: ReadonlySet<string>,
): boolean {
  if (
    !contract.workspace_parameters ||
    typeof contract.workspace_parameters !== 'object' ||
    Array.isArray(contract.workspace_parameters) ||
    !Array.isArray(contract.step_configurations) ||
    contract.step_configurations.length > 8
  ) {
    return false
  }
  const validOptions = (value: unknown): boolean => {
    if (isWorkspaceRerunParameterValue(value)) return true
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    return Object.entries(value).every(
      ([key, entry]) =>
        !['__proto__', 'prototype', 'constructor'].includes(key) && validOptions(entry),
    )
  }
  return (
    validOptions(contract.workspace_parameters) &&
    contract.step_configurations.every(
      (update) =>
        typeof update.step_id === 'string' &&
        flowSteps.has(update.step_id) &&
        validOptions(update.options),
    )
  )
}

export async function executeWorkspaceRerunDomain(
  contract: DesktopAgentWorkspaceRerunContract,
  runtime: WorkspaceRerunRuntime,
  workspaceHandle: string,
  initialWorkspaceRevision: number | undefined,
  flowSteps: ReadonlySet<string>,
): Promise<void> {
  if (!hasValidWorkspaceRerunDomainUpdates(contract, flowSteps)) {
    throw new Error('Workspace rerun contract is invalid.')
  }
  if (!Number.isInteger(initialWorkspaceRevision)) {
    throw new Error('Workspace rerun revision is unavailable.')
  }
  let workspaceRevision = initialWorkspaceRevision!
  if (Object.keys(contract.workspace_parameters).length) {
    const updated = await runtime.updateWorkspaceConfiguration({
      commandId: randomUUID(),
      configuration: {
        design: {},
        parameters: contract.workspace_parameters,
        pdk: {},
      },
      expectedWorkspaceRevision: workspaceRevision,
      workspaceHandle,
    })
    workspaceRevision = updated.workspaceRevision
  }
  for (const update of contract.step_configurations) {
    const updated = await runtime.updateWorkspaceStepConfiguration({
      commandId: randomUUID(),
      expectedWorkspaceRevision: workspaceRevision,
      options: update.options,
      stepId: update.step_id,
      workspaceHandle,
    })
    workspaceRevision = updated.workspaceRevision
  }
  const operation =
    contract.execution_scope === 'full_flow'
      ? await runtime.startFlowOperation({
          expectedWorkspaceRevision: workspaceRevision,
          idempotencyKey: randomUUID(),
          rerun: false,
          workspaceHandle,
        })
      : await runtime.startStepOperation({
          expectedWorkspaceRevision: workspaceRevision,
          idempotencyKey: randomUUID(),
          rerun: false,
          step: contract.target_step,
          workspaceHandle,
        })
  const completed = await runtime.waitForOperation({
    operationId: operation.operationId,
    workspaceHandle,
  })
  if (completed.state !== 'succeeded') {
    throw new Error(
      completed.error?.message ||
        (contract.execution_scope === 'full_flow'
          ? 'Rerun flow failed'
          : `Rerun step failed: ${contract.target_step}`),
    )
  }
}

function isSafeParameterString(value: string): boolean {
  return (
    value.length <= 256 &&
    !value.includes('`') &&
    !value.includes('..') &&
    !value.split('').some((character) => character.charCodeAt(0) < 32) &&
    !/[;&|]|\$\(/.test(value)
  )
}
