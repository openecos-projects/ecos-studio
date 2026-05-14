import { reactive, toRef } from 'vue'
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
