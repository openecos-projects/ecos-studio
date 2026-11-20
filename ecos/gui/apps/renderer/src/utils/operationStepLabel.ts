import type { EccRuntimeOperation } from '@ecos-studio/shared'

export function operationStepLabel(
  operation: EccRuntimeOperation | null | undefined,
): string {
  if (!operation) return ''
  const running = operation.flow?.steps.filter((step) => step.state === 'Ongoing')
  if (running?.length) return running.map((step) => step.name).join(', ')
  return operation.currentStep || operation.step || ''
}
