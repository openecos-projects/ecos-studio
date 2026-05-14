import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

function loadFlowLogChooserController() {
  const helperScript = homeViewSource.match(/<script lang="ts">\s*([\s\S]*?)<\/script>\s*<script setup lang="ts">/)

  expect(helperScript?.[1]).toBeTruthy()

  const normalizedScript = helperScript![1]
    .replace(/export interface[\s\S]*?\n}\n/g, '')
    .replace(
      /export function createFlowLogChooserController\(initialSelectedKey: string \| null = null\): FlowLogChooserController/,
      'function createFlowLogChooserController(initialSelectedKey = null)',
    )
    .replace(
      /export function computeFlowLogChooserAnchorStyle\(\s*triggerRect: FlowLogChooserRect,\s*viewport: FlowLogChooserViewport,\s*chooserSize: FlowLogChooserSize,\s*\): FlowLogChooserAnchorStyle/,
      'function computeFlowLogChooserAnchorStyle(triggerRect, viewport, chooserSize)',
    )
    .replace(/const controller: FlowLogChooserController =/, 'const controller =')
    .replace(/toggleFlowLogStepChooser\(this: FlowLogChooserController\)/, 'toggleFlowLogStepChooser()')
    .replace(/closeFlowLogStepChooser\(this: FlowLogChooserController\)/, 'closeFlowLogStepChooser()')
    .replace(/onSelectFlowLogStep\(this: FlowLogChooserController, key: string\)/, 'onSelectFlowLogStep(key)')
    .replace(/jumpToLiveStep\(this: FlowLogChooserController, liveKey: string \| null\)/, 'jumpToLiveStep(liveKey)')
    .replace(/onFlowLogChooserEscape\(this: FlowLogChooserController, event: FlowLogChooserEscapeEvent\)/, 'onFlowLogChooserEscape(event)')
    .replace(/onSelectFlowLogStep\(key: string\)/, 'onSelectFlowLogStep(key)')
    .replace(/jumpToLiveStep\(liveKey: string \| null\)/, 'jumpToLiveStep(liveKey)')
    .replace(/onFlowLogChooserEscape\(event: FlowLogChooserEscapeEvent\)/, 'onFlowLogChooserEscape(event)')

  return new Function(`${normalizedScript}\nreturn createFlowLogChooserController`)() as (
    initialSelectedKey?: string | null
  ) => {
    isFlowLogStepChooserOpen: boolean
    toggleFlowLogStepChooser: () => void
    onFlowLogChooserEscape: (event: { key: string; preventDefault?: () => void }) => void
  }
}

function loadFlowLogChooserAnchorHelper() {
  const helperScript = homeViewSource.match(/<script lang="ts">\s*([\s\S]*?)<\/script>\s*<script setup lang="ts">/)

  expect(helperScript?.[1]).toBeTruthy()

  const normalizedScript = helperScript![1]
    .replace(/export interface[\s\S]*?\n}\n/g, '')
    .replace(
      /export function createFlowLogChooserController\(initialSelectedKey: string \| null = null\): FlowLogChooserController/,
      'function createFlowLogChooserController(initialSelectedKey = null)',
    )
    .replace(
      /export function computeFlowLogChooserAnchorStyle\(\s*triggerRect: FlowLogChooserRect,\s*viewport: FlowLogChooserViewport,\s*chooserSize: FlowLogChooserSize,\s*\): FlowLogChooserAnchorStyle/,
      'function computeFlowLogChooserAnchorStyle(triggerRect, viewport, chooserSize)',
    )
    .replace(/const controller: FlowLogChooserController =/, 'const controller =')
    .replace(/toggleFlowLogStepChooser\(this: FlowLogChooserController\)/, 'toggleFlowLogStepChooser()')
    .replace(/closeFlowLogStepChooser\(this: FlowLogChooserController\)/, 'closeFlowLogStepChooser()')
    .replace(/onSelectFlowLogStep\(this: FlowLogChooserController, key: string\)/, 'onSelectFlowLogStep(key)')
    .replace(/jumpToLiveStep\(this: FlowLogChooserController, liveKey: string \| null\)/, 'jumpToLiveStep(liveKey)')
    .replace(/onFlowLogChooserEscape\(this: FlowLogChooserController, event: FlowLogChooserEscapeEvent\)/, 'onFlowLogChooserEscape(event)')
    .replace(/onSelectFlowLogStep\(key: string\)/, 'onSelectFlowLogStep(key)')
    .replace(/jumpToLiveStep\(liveKey: string \| null\)/, 'jumpToLiveStep(liveKey)')
    .replace(/onFlowLogChooserEscape\(event: FlowLogChooserEscapeEvent\)/, 'onFlowLogChooserEscape(event)')

  return new Function(`${normalizedScript}\nreturn computeFlowLogChooserAnchorStyle`)() as (
    triggerRect: { top: number; left: number; right: number; bottom: number; width: number; height: number },
    viewport: { width: number; height: number },
    chooserSize: { width: number; height: number },
  ) => {
    left: string
    top: string
    transformOrigin: string
  }
}

describe('HomeView current-step log viewer state', () => {
  it('tracks a selected flow log key and derived selected segment', () => {
    expect(homeViewSource).toContain('selectedFlowLogKey')
    expect(homeViewSource).toContain('selectedFlowLogSegment')
    expect(homeViewSource).toContain('flowLogListItems')
  })

  it('offers chooser actions to jump live and keeps full-log expansion in the header', () => {
    expect(homeViewSource).toContain('jumpToLiveStep')
    expect(homeViewSource).toContain('Show full log')
    expect(homeViewSource).toContain('flow-log-viewer-actions')
    expect(homeViewSource).toContain('flow-log-viewer-summary-row')
    expect(homeViewSource).not.toContain('flow-log-viewer-meta-row')
  })

  it('lets the live watcher wait for a missing log instead of repeatedly reading on selection', () => {
    expect(homeViewSource).toContain('if (segment.live && !selectedFlowLogContent.value)')
    expect(homeViewSource).toContain('await ensureFlowLogSegmentContentLoaded(segment)')
  })

  it('adds dialog semantics and escape handling for the transient chooser', () => {
    expect(homeViewSource).toContain('role="dialog"')
    expect(homeViewSource).toContain('aria-modal="true"')
    expect(homeViewSource).toContain('aria-haspopup="dialog"')
    expect(homeViewSource).toContain('aria-controls="flow-log-step-chooser-dialog"')

    const createFlowLogChooserController = loadFlowLogChooserController()
    const chooser = createFlowLogChooserController('step-a')
    chooser.toggleFlowLogStepChooser()

    let prevented = false
    chooser.onFlowLogChooserEscape({
      key: 'Escape',
      preventDefault: () => {
        prevented = true
      },
    })

    expect(chooser.isFlowLogStepChooserOpen).toBe(false)
    expect(prevented).toBe(true)
  })

  it('anchors the chooser near the trigger and flips above when there is not enough space below', () => {
    const computeFlowLogChooserAnchorStyle = loadFlowLogChooserAnchorHelper()

    const style = computeFlowLogChooserAnchorStyle(
      {
        top: 760,
        left: 980,
        right: 1060,
        bottom: 792,
        width: 80,
        height: 32,
      },
      {
        width: 1440,
        height: 900,
      },
      {
        width: 320,
        height: 300,
      },
    )

    expect(style.left).toBe('740px')
    expect(style.top).toBe('452px')
    expect(style.transformOrigin).toBe('bottom right')
  })
})
