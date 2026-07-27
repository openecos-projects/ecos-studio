export type FlowLogCopyResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'failed'; message?: string }

export type FlowLogCopyFeedback = 'copied' | 'empty' | 'failed'

export type FlowLogCopyTooltipPlacement = 'below' | 'above'

export type FlowLogCopyTooltipStyle = {
  left: string
  top: string
  placement: FlowLogCopyTooltipPlacement
}

export function flowLogCopyFeedbackTooltip(
  feedback: FlowLogCopyFeedback | null,
): string {
  switch (feedback) {
    case 'copied':
      return 'Copied to clipboard'
    case 'empty':
      return 'Nothing to copy'
    case 'failed':
      return 'Copy failed'
    default:
      return 'Copy log text'
  }
}

export function flowLogCopyFeedbackFromResult(
  result: FlowLogCopyResult,
): FlowLogCopyFeedback {
  if (result.ok) return 'copied'
  return result.reason
}

export function computeFlowLogCopyTooltipStyle(
  triggerRect: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  options?: {
    gapPx?: number
    paddingPx?: number
    tooltipWidthPx?: number
    tooltipHeightPx?: number
  },
): FlowLogCopyTooltipStyle {
  const gapPx = options?.gapPx ?? 6
  const paddingPx = options?.paddingPx ?? 8
  const tooltipWidthPx = Math.max(1, options?.tooltipWidthPx ?? 148)
  const tooltipHeightPx = Math.max(1, options?.tooltipHeightPx ?? 28)

  let left = triggerRect.right - tooltipWidthPx
  const maxLeft = Math.max(paddingPx, viewport.width - tooltipWidthPx - paddingPx)
  left = Math.max(paddingPx, Math.min(left, maxLeft))

  const belowTop = triggerRect.bottom + gapPx
  const aboveTop = triggerRect.top - gapPx - tooltipHeightPx
  const fitsBelow = belowTop + tooltipHeightPx + paddingPx <= viewport.height
  const fitsAbove = aboveTop >= paddingPx

  let top = belowTop
  let placement: FlowLogCopyTooltipPlacement = 'below'
  if (!fitsBelow && fitsAbove) {
    top = aboveTop
    placement = 'above'
  } else if (!fitsBelow && !fitsAbove) {
    top = Math.max(
      paddingPx,
      Math.min(belowTop, viewport.height - tooltipHeightPx - paddingPx),
    )
  }

  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    placement,
  }
}

export async function copyFlowLogText(
  text: string,
  writeText: (value: string) => Promise<void> = (value) =>
    navigator.clipboard.writeText(value),
): Promise<FlowLogCopyResult> {
  if (!text) {
    return { ok: false, reason: 'empty' }
  }

  try {
    await writeText(text)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      reason: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
