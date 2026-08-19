export const FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX = 16

export type FlowLogContextMenuStyle = {
  left: string
  top: string
}

export type FlowLogContentUpdate =
  | { kind: 'none'; text: '' }
  | { kind: 'append'; text: string }
  | { kind: 'replace'; text: string }

export function flowLogContentUpdate(
  previousContent: string,
  nextContent: string,
): FlowLogContentUpdate {
  if (previousContent === nextContent) return { kind: 'none', text: '' }
  if (nextContent.startsWith(previousContent)) {
    return { kind: 'append', text: nextContent.slice(previousContent.length) }
  }
  return { kind: 'replace', text: nextContent }
}

export function isFlowLogViewerNearTail(
  metrics: {
    scrollHeight: number
    scrollTop: number
    clientHeight: number
  },
  thresholdPx = FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= thresholdPx
}

export function computeFlowLogContextMenuStyle(
  pointer: { x: number; y: number },
  viewport: { width: number; height: number },
  options?: {
    menuWidthPx?: number
    menuHeightPx?: number
    paddingPx?: number
  },
): FlowLogContextMenuStyle {
  const menuWidthPx = Math.max(1, options?.menuWidthPx ?? 124)
  const menuHeightPx = Math.max(1, options?.menuHeightPx ?? 36)
  const paddingPx = options?.paddingPx ?? 8
  const maxLeft = Math.max(paddingPx, viewport.width - menuWidthPx - paddingPx)
  const maxTop = Math.max(paddingPx, viewport.height - menuHeightPx - paddingPx)

  return {
    left: `${Math.round(Math.max(paddingPx, Math.min(pointer.x, maxLeft)))}px`,
    top: `${Math.round(Math.max(paddingPx, Math.min(pointer.y, maxTop)))}px`,
  }
}
