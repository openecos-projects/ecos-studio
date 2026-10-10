export type FlowNodeStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'warning'
  | 'failed'
  | 'skipped'

export interface FlowStatusNode {
  id: string
  label: string
  status: FlowNodeStatus
  runtime: string
  peakMemoryMb: number | null
  detail?: string
}

export interface FlowStatusSummary {
  queued: number
  running: number
  succeeded: number
  warning: number
  failed: number
  skipped: number
}

export interface FlowNodeSelectionUpdate {
  runningNodeId: string | null
  selectedNodeId: string | null
}

export function flowNodeStatus(value: string | null | undefined): FlowNodeStatus {
  switch (value?.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'complete':
      return 'succeeded'
    case 'warning':
      return 'warning'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'incomplete':
    case 'invalid':
    case 'failed':
    case 'failure':
    case 'error':
      return 'failed'
    case 'skipped':
    case 'skip':
      return 'skipped'
    default:
      return 'queued'
  }
}

export function flowStatusSummary(nodes: readonly FlowStatusNode[]): FlowStatusSummary {
  const summary: FlowStatusSummary = {
    queued: 0,
    running: 0,
    succeeded: 0,
    warning: 0,
    failed: 0,
    skipped: 0,
  }
  for (const node of nodes) summary[node.status] += 1
  return summary
}

export function statusLabel(status: FlowNodeStatus): string {
  switch (status) {
    case 'succeeded':
      return 'Succeeded'
    case 'running':
      return 'Running'
    case 'warning':
      return 'Completed with warnings'
    case 'failed':
      return 'Failed'
    case 'skipped':
      return 'Skipped'
    default:
      return 'Queued'
  }
}

export function statusIcon(status: FlowNodeStatus): string {
  switch (status) {
    case 'succeeded':
      return 'ri-checkbox-circle-fill'
    case 'running':
      return 'ri-loader-4-line'
    case 'warning':
      return 'ri-error-warning-fill'
    case 'failed':
      return 'ri-close-circle-fill'
    case 'skipped':
      return 'ri-skip-forward-fill'
    default:
      return 'ri-time-line'
  }
}

export function formatPeakMemory(peakMemoryMb: number | null): string {
  if (peakMemoryMb === null || !Number.isFinite(peakMemoryMb)) return '--'
  if (peakMemoryMb < 1024) return `${Math.round(peakMemoryMb)} MB`
  return `${(peakMemoryMb / 1024).toFixed(1)} GB`
}

export function formatRuntime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
  const milliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(milliseconds / 3600000)
  const minutes = Math.floor((milliseconds % 3600000) / 60000)
  const wholeSeconds = Math.floor((milliseconds % 60000) / 1000)
  const fraction = milliseconds % 1000
  const secondText = `${String(wholeSeconds).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(3, '0').replace(/0+$/, '')}` : ''}`
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secondText}`
}

export function initialSelectedNodeId(nodes: readonly FlowStatusNode[]): string | null {
  return runningFlowNodeId(nodes) ?? nodes[0]?.id ?? null
}

export function runningFlowNodeId(nodes: readonly FlowStatusNode[]): string | null {
  return nodes.find((node) => node.status === 'running')?.id ?? null
}

export function nextFlowNodeSelection(
  nodes: readonly FlowStatusNode[],
  selectedNodeId: string | null,
  previousRunningNodeId: string | null,
): FlowNodeSelectionUpdate {
  const runningNodeId = runningFlowNodeId(nodes)
  if (runningNodeId && runningNodeId !== previousRunningNodeId) {
    return { runningNodeId, selectedNodeId: runningNodeId }
  }

  return {
    runningNodeId,
    selectedNodeId: nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : initialSelectedNodeId(nodes),
  }
}
