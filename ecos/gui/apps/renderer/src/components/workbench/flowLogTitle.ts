import { formatPeakMemory, type FlowStatusNode } from './flowStatus'

export interface FlowLogTitleSegment {
  stepName: string
  tool: string
  runtime?: string
  peakMemoryMb?: number | null
}

/** Matches the HH:MM:SS runtime shape ECC persists into flow.json. */
export function formatLiveRuntime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/**
 * Prefer the selected log segment because it is rebuilt from the active
 * workspace's home/flow.json. The status node remains a fallback before logs load.
 * An empty segment runtime (a step whose flow.json commit has not been read yet)
 * counts as missing so the node's committed runtime can fill in.
 */
export function formatFlowLogTitle(
  segment: FlowLogTitleSegment | null,
  node: FlowStatusNode | null,
): string {
  const stepName = segment?.stepName.trim() || node?.label.trim() || 'Flow log'
  const tool = segment?.tool.trim()
  const stepAndTool = tool ? `${stepName} · ${tool}` : stepName
  const segmentRuntime =
    typeof segment?.runtime === 'string' ? segment.runtime.trim() : ''
  const runtime = segmentRuntime || node?.runtime.trim() || '--'
  const peakMemoryMb =
    segment?.peakMemoryMb === undefined
      ? (node?.peakMemoryMb ?? null)
      : segment.peakMemoryMb

  return `${stepAndTool} · Runtime ${runtime} · Peak memory ${formatPeakMemory(peakMemoryMb)}`
}
