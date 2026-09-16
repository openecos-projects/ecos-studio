import { sameFlowStepName } from '@/api/type'

export function matchingFlowLogSegments<T extends { stepName: string }>(
  segments: readonly T[],
  stepName: string,
): T[] {
  const requested = stepName.trim()
  if (!requested) return []
  return segments.filter((segment) => sameFlowStepName(segment.stepName, requested))
}

export function selectedFlowLogSegment<T extends { stepName: string; live?: boolean }>(
  segments: readonly T[],
  stepName: string,
): T | undefined {
  const matching = matchingFlowLogSegments(segments, stepName)
  return matching.find((segment) => segment.live) ?? matching[matching.length - 1]
}
