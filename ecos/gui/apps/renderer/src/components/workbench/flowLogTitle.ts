import { formatPeakMemory, type FlowStatusNode } from './flowStatus'

export interface FlowLogTitleSegment {
  stepName: string
  tool: string
  runtime?: string
  peakMemoryMb?: number | null
}

/**
 * Prefer the selected log segment because it is rebuilt from the active
 * workspace's home/flow.json. The status node remains a fallback before logs load.
 */
export function formatFlowLogTitle(
  segment: FlowLogTitleSegment | null,
  node: FlowStatusNode | null,
): string {
  const stepName = segment?.stepName.trim() || node?.label.trim() || 'Flow log'
  const tool = segment?.tool.trim()
  const stepAndTool = tool ? `${stepName} · ${tool}` : stepName
  const runtime =
    typeof segment?.runtime === 'string'
      ? segment.runtime.trim() || '--'
      : node?.runtime.trim() || '--'
  const peakMemoryMb =
    segment?.peakMemoryMb === undefined
      ? (node?.peakMemoryMb ?? null)
      : segment.peakMemoryMb

  return `${stepAndTool} · Runtime ${runtime} · Peak memory ${formatPeakMemory(peakMemoryMb)}`
}
