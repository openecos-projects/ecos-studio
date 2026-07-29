import { reactive, toRef } from 'vue'
import { describe, expect, it } from 'vitest'
import homeViewSource from './HomeView.vue?raw'

function normalizeHomeViewHelperScript(script: string) {
  return script
    .replace(/export interface[\s\S]*?\n}\n/g, '')
    .replace(
      /export function createFlowLogChooserController\(\s*initialSelectedKey: string \| null = null,?\s*\): FlowLogChooserController/,
      'function createFlowLogChooserController(initialSelectedKey = null)',
    )
    .replace(
      /export function computeFlowLogChooserAnchorStyle\(\s*triggerRect: FlowLogChooserRect,\s*viewport: FlowLogChooserViewport,\s*chooserSize: FlowLogChooserSize,\s*\): FlowLogChooserAnchorStyle/,
      'function computeFlowLogChooserAnchorStyle(triggerRect, viewport, chooserSize)',
    )
    .replace(/const controller: FlowLogChooserController =/, 'const controller =')
    .replace(
      /(\w+)\(\s*this: FlowLogChooserController,\s*(\w+): string \| null,?\s*\)/g,
      '$1($2)',
    )
    .replace(
      /(\w+)\(\s*this: FlowLogChooserController,\s*(\w+): string,?\s*\)/g,
      '$1($2)',
    )
    .replace(
      /(\w+)\(\s*this: FlowLogChooserController,\s*(\w+): FlowLogChooserEscapeEvent,?\s*\)/g,
      '$1($2)',
    )
    .replace(/(\w+)\(\s*this: FlowLogChooserController,?\s*\)/g, '$1()')
}

function loadFlowLogChooserController() {
  const helperScript = homeViewSource.match(
    /<script lang="ts">\s*([\s\S]*?)<\/script>\s*<script setup lang="ts">/,
  )

  expect(helperScript?.[1]).toBeTruthy()

  const normalizedScript = normalizeHomeViewHelperScript(helperScript![1])

  return new Function(`${normalizedScript}\nreturn createFlowLogChooserController`)() as (
    initialSelectedKey?: string | null,
  ) => {
    selectedFlowLogKey: string | null
    isFlowLogStepChooserOpen: boolean
    toggleFlowLogStepChooser: () => void
    closeFlowLogStepChooser: () => void
    onSelectFlowLogStep: (key: string) => void
    jumpToLiveStep: (liveKey: string | null) => void
  }
}

describe('HomeView floating chooser integration', () => {
  it('replaces the permanent step rail with a transient chooser trigger', () => {
    expect(homeViewSource).toContain('FlowLogStepChooser')
    expect(homeViewSource).toContain('isFlowLogStepChooserOpen')
    expect(homeViewSource).not.toContain('FlowLogStepList')
  })

  it('anchors step switching in the header while keeping the viewer full width', () => {
    expect(homeViewSource).toContain('toggleFlowLogStepChooser')
    expect(homeViewSource).toContain('closeFlowLogStepChooser')
    expect(homeViewSource).toContain('flow-log-viewer-shell')
  })

  it('exposes a copy action with teleported tooltip feedback', () => {
    expect(homeViewSource).toContain('flow-log-copy-btn')
    expect(homeViewSource).toContain('flow-log-copy-tooltip')
    expect(homeViewSource).toContain('computeFlowLogCopyTooltipStyle')
    expect(homeViewSource).toContain('refineFlowLogCopyTooltipPosition')
    expect(homeViewSource).toContain('canCopyFlowLogText')
    expect(homeViewSource).toContain('onCopyFlowLogText')
    expect(homeViewSource).toContain('copyFlowLogText')
    expect(homeViewSource).toContain("is-copied': flowLogCopyFeedback === 'copied'")
    expect(homeViewSource).toContain("flowLogCopyFeedback === 'failed'")
    expect(homeViewSource).toContain(
      "is-above': flowLogCopyTooltipStyle?.placement === 'above'",
    )
    expect(homeViewSource).not.toContain('is-feedback')
  })

  it('exports chooser state transitions that close after selection and jump-to-live', () => {
    const createFlowLogChooserController = loadFlowLogChooserController()
    const chooser = createFlowLogChooserController('step-a')

    chooser.toggleFlowLogStepChooser()
    expect(chooser.isFlowLogStepChooserOpen).toBe(true)

    chooser.onSelectFlowLogStep('step-b')
    expect(chooser.selectedFlowLogKey).toBe('step-b')
    expect(chooser.isFlowLogStepChooserOpen).toBe(false)

    chooser.toggleFlowLogStepChooser()
    chooser.jumpToLiveStep('step-live')
    expect(chooser.selectedFlowLogKey).toBe('step-live')
    expect(chooser.isFlowLogStepChooserOpen).toBe(false)
  })

  it('updates chooser open state through a reactive wrapper', () => {
    const createFlowLogChooserController = loadFlowLogChooserController()
    const chooser = reactive(createFlowLogChooserController('step-a'))
    const isOpen = toRef(chooser, 'isFlowLogStepChooserOpen')

    chooser.toggleFlowLogStepChooser()
    expect(isOpen.value).toBe(true)

    chooser.closeFlowLogStepChooser()
    expect(isOpen.value).toBe(false)
  })
})
