import type { Extension } from '@codemirror/state'
import { EditorState } from '@codemirror/state'
import { search, searchKeymap } from '@codemirror/search'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'

export const FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX = 16

export function buildFlowLogViewerExtensions(): Extension[] {
  return [
    lineNumbers(),
    search({
      top: true,
    }),
    keymap.of(searchKeymap),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
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
