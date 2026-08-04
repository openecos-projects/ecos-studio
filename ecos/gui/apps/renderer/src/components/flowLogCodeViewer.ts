import type { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import { search, searchKeymap } from '@codemirror/search'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'

export const FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX = 16
export const FLOW_LOG_SCROLLBAR_MIN_THUMB_PX = 32
export const FLOW_LOG_WHEEL_LINE_HEIGHT_PX = 18

export type FlowLogViewerSelectionState = {
  selection: {
    main: {
      from: number
      to: number
      empty: boolean
    }
  }
  sliceDoc: (from: number, to: number) => string
}

export type FlowLogContextMenuStyle = {
  left: string
  top: string
}

export type FlowLogVerticalScrollbarGeometry = {
  maxScrollTop: number
  thumbHeight: number
  thumbOffset: number
}

export function buildFlowLogViewerExtensions(): Extension[] {
  return [
    lineNumbers(),
    search({
      top: true,
    }),
    keymap.of(searchKeymap),
    EditorState.readOnly.of(true),
    EditorView.lineWrapping,
    EditorView.theme({
      '&': {
        height: '100%',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontSize: '11px',
      },
      '.cm-scroller': {
        fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, monospace",
        lineHeight: '1.6',
      },
      '.cm-content': {
        padding: '12px 0 16px',
      },
      '.cm-line': {
        padding: '0 16px',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-secondary)',
        borderRight: '1px solid var(--border-color)',
        fontSize: '10px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
      },
      '.cm-panels': {
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        borderBottom: '1px solid var(--border-color)',
      },
      '.cm-search input': {
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-color)',
      },
      '.cm-button': {
        backgroundImage: 'none',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-color)',
      },
      '.cm-tooltip': {
        border: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-secondary)',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'rgba(var(--accent-rgb, 59, 130, 246), 0.22) !important',
      },
    }),
  ]
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

export function flowLogVerticalScrollbarGeometry(metrics: {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}): FlowLogVerticalScrollbarGeometry {
  const viewportHeight = Math.max(0, metrics.clientHeight)
  const scrollHeight = Math.max(viewportHeight, metrics.scrollHeight)
  const maxScrollTop = Math.max(0, scrollHeight - viewportHeight)
  const thumbHeight =
    viewportHeight === 0
      ? 0
      : Math.max(
          Math.min(FLOW_LOG_SCROLLBAR_MIN_THUMB_PX, viewportHeight),
          (viewportHeight / scrollHeight) * viewportHeight,
        )
  const thumbTravel = Math.max(0, viewportHeight - thumbHeight)
  const normalizedScrollTop = Math.max(0, Math.min(metrics.scrollTop, maxScrollTop))

  return {
    maxScrollTop,
    thumbHeight,
    thumbOffset:
      maxScrollTop === 0 ? 0 : (normalizedScrollTop / maxScrollTop) * thumbTravel,
  }
}

export function flowLogWheelDeltaPx(metrics: {
  deltaY: number
  deltaMode: number
  clientHeight: number
}): number {
  if (metrics.deltaMode === 1) return metrics.deltaY * FLOW_LOG_WHEEL_LINE_HEIGHT_PX
  if (metrics.deltaMode === 2) return metrics.deltaY * Math.max(1, metrics.clientHeight)
  return metrics.deltaY
}

export function getFlowLogViewerSelectedText(state: FlowLogViewerSelectionState): string {
  const selection = state.selection.main
  if (selection.empty) return ''
  return state.sliceDoc(selection.from, selection.to)
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
