export type FlowNodeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped'

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
  failed: number
  skipped: number
}

export function flowNodeStatus(value: string | null | undefined): FlowNodeStatus {
  switch (value?.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'complete':
      return 'succeeded'
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

export function initialSelectedNodeId(nodes: readonly FlowStatusNode[]): string | null {
  return nodes.find((node) => node.status === 'running')?.id ?? nodes[0]?.id ?? null
}
