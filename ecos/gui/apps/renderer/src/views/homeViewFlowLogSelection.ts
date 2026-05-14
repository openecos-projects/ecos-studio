import type { FlowLogSegment } from '@/composables/useHomeData'

export interface FlowLogListItem {
  key: string
  stepName: string
  tool: string
  state: string
  failed: boolean
  live: boolean
  truncated: boolean
  missing: boolean
  totalSize?: number
}

export function flowLogStepKey(seg: Pick<FlowLogSegment, 'stepName' | 'tool'>): string {
  return `${seg.stepName}\u001f${seg.tool}`
}

export function getDefaultSelectedFlowLogKey(
  segments: readonly FlowLogSegment[],
): string | null {
  const liveSegment = segments.find((segment) => segment.live)
  if (liveSegment) return flowLogStepKey(liveSegment)

  const lastSegment = segments[segments.length - 1]
  return lastSegment ? flowLogStepKey(lastSegment) : null
}

export function reconcileSelectedFlowLogKey(
  segments: readonly FlowLogSegment[],
  selectedKey: string | null,
  options: { preferLive?: boolean } = {},
): string | null {
  if (options.preferLive) {
    const liveSegment = segments.find((segment) => segment.live)
    if (liveSegment) return flowLogStepKey(liveSegment)
  }

  if (selectedKey && segments.some((segment) => flowLogStepKey(segment) === selectedKey)) {
    return selectedKey
  }
  return getDefaultSelectedFlowLogKey(segments)
}

export function toFlowLogListItems(
  segments: readonly FlowLogSegment[],
): FlowLogListItem[] {
  return segments.map((segment) => ({
    key: flowLogStepKey(segment),
    stepName: segment.stepName,
    tool: segment.tool,
    state: segment.state,
    failed: segment.failed,
    live: Boolean(segment.live),
    truncated: Boolean(segment.truncated),
    missing: segment.missing,
    totalSize: segment.totalSize,
  }))
}
