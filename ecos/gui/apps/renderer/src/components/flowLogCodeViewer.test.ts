// @vitest-environment happy-dom

import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '@/stores/themeStore'
import FlowLogCodeViewer from './FlowLogCodeViewer.vue'
import {
  computeFlowLogContextMenuStyle,
  flowLogContentUpdate,
  isFlowLogViewerNearTail,
} from './flowLogCodeViewer'

const runtimeMocks = vi.hoisted(() => ({
  getMonacoRuntime: vi.fn(),
  nextMonacoEditorId: vi.fn(),
  setMonacoTheme: vi.fn(),
}))

const copyMocks = vi.hoisted(() => ({
  copyFlowLogText: vi.fn(),
}))

vi.mock('./monacoRuntime', () => runtimeMocks)
vi.mock('./flowLogCopy', () => copyMocks)

class FakeRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}

  getEndPosition() {
    return { lineNumber: this.endLineNumber, column: this.endColumn }
  }
}

class FakeModel {
  value = ''
  readonly applyEdits = vi.fn((edits: Array<{ range: FakeRange; text: string }>) => {
    for (const edit of edits) {
      const from = this.offsetAt(edit.range.startLineNumber, edit.range.startColumn)
      const to = this.offsetAt(edit.range.endLineNumber, edit.range.endColumn)
      this.value = `${this.value.slice(0, from)}${edit.text}${this.value.slice(to)}`
    }
  })
  readonly deltaDecorations = vi.fn((_previous: string[], decorations: unknown[]) =>
    decorations.map((_, index) => `decoration-${index}`),
  )
  readonly dispose = vi.fn()

  getFullModelRange(): FakeRange {
    const lines = this.value.split('\n')
    return new FakeRange(1, 1, lines.length, (lines[lines.length - 1]?.length ?? 0) + 1)
  }

  getValueInRange(range: FakeRange): string {
    const from = this.offsetAt(range.startLineNumber, range.startColumn)
    const to = this.offsetAt(range.endLineNumber, range.endColumn)
    return this.value.slice(from, to)
  }

  private offsetAt(lineNumber: number, column: number): number {
    const lines = this.value.split('\n')
    return (
      lines
        .slice(0, Math.max(0, lineNumber - 1))
        .reduce((sum, line) => sum + line.length + 1, 0) + Math.max(0, column - 1)
    )
  }
}

class FakeEditor {
  model: FakeModel | null = null
  scrollHeight = 100
  scrollTop = 0
  layoutHeight = 100
  selection = new FakeRange(1, 1, 1, 1)
  readonly setModel = vi.fn((model: FakeModel | null) => {
    this.model = model
  })
  readonly saveViewState = vi.fn(() => ({ scrollTop: this.scrollTop }))
  readonly restoreViewState = vi.fn((state: { scrollTop: number }) => {
    this.scrollTop = state.scrollTop
  })
  readonly setScrollPosition = vi.fn(
    (position: { scrollTop?: number; scrollLeft?: number }) => {
      if (position.scrollTop !== undefined) this.scrollTop = position.scrollTop
    },
  )
  readonly setScrollTop = vi.fn((scrollTop: number) => {
    this.scrollTop = scrollTop
  })
  readonly dispose = vi.fn()

  getModel(): FakeModel | null {
    return this.model
  }

  getScrollHeight(): number {
    return this.scrollHeight
  }

  getScrollTop(): number {
    return this.scrollTop
  }

  getLayoutInfo(): { height: number } {
    return { height: this.layoutHeight }
  }

  getSelection(): FakeRange & { isEmpty: () => boolean } {
    const selection = this.selection
    return Object.assign(selection, {
      isEmpty: () =>
        selection.startLineNumber === selection.endLineNumber &&
        selection.startColumn === selection.endColumn,
    })
  }
}

let wrapper: VueWrapper | null = null
let editor: FakeEditor
let models: FakeModel[]
let editorOptions: Record<string, unknown>
let animationFrames: Map<number, FrameRequestCallback>
let nextAnimationFrameId: number

const monaco = {
  Range: FakeRange,
  Uri: {
    from: vi.fn((value: unknown) => value),
  },
  editor: {
    create: vi.fn((_host: HTMLElement, options: Record<string, unknown>) => {
      editorOptions = options
      return editor
    }),
    createModel: vi.fn(() => {
      const model = new FakeModel()
      models.push(model)
      return model
    }),
  },
}

function flushNextAnimationFrame(): boolean {
  const next = animationFrames.entries().next().value
  if (!next) return false
  const [id, callback] = next
  animationFrames.delete(id)
  callback(performance.now())
  return true
}

async function mountViewer(
  props: Partial<{
    ariaLabel: string
    channelKey: string
    content: string
    live: boolean
    loading: boolean
    missing: boolean
  }> = {},
): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(FlowLogCodeViewer, {
    props: {
      content: '',
      ...props,
    },
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
  await flushPromises()
  await vi.waitFor(() => {
    expect(runtimeMocks.getMonacoRuntime).toHaveBeenCalled()
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  editor = new FakeEditor()
  models = []
  editorOptions = {}
  animationFrames = new Map()
  nextAnimationFrameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextAnimationFrameId
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
  runtimeMocks.getMonacoRuntime.mockReturnValue(monaco)
  runtimeMocks.nextMonacoEditorId.mockReturnValue(7)
  copyMocks.copyFlowLogText.mockResolvedValue({ ok: true })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

describe('flowLogCodeViewer helpers', () => {
  it('distinguishes unchanged, appended, and replaced log content', () => {
    expect(flowLogContentUpdate('line', 'line')).toEqual({
      kind: 'none',
      text: '',
    })
    expect(flowLogContentUpdate('line', 'line\nnext')).toEqual({
      kind: 'append',
      text: '\nnext',
    })
    expect(flowLogContentUpdate('old', 'new')).toEqual({
      kind: 'replace',
      text: 'new',
    })
  })

  it('treats only near-tail scroll positions as pinned', () => {
    expect(
      isFlowLogViewerNearTail({
        scrollHeight: 1000,
        scrollTop: 686,
        clientHeight: 300,
      }),
    ).toBe(true)
    expect(
      isFlowLogViewerNearTail({
        scrollHeight: 1000,
        scrollTop: 600,
        clientHeight: 300,
      }),
    ).toBe(false)
  })

  it('keeps the selection context menu inside the viewport', () => {
    expect(
      computeFlowLogContextMenuStyle({ x: 990, y: 790 }, { width: 1000, height: 800 }),
    ).toEqual({ left: '868px', top: '756px' })
    expect(
      computeFlowLogContextMenuStyle({ x: 1, y: 2 }, { width: 1000, height: 800 }),
    ).toEqual({ left: '8px', top: '8px' })
  })
})

describe('FlowLogCodeViewer Monaco behavior', () => {
  it('creates a selectable read-only Monaco log editor with line numbers and find support', async () => {
    const mounted = await mountViewer({ content: 'first line' })

    expect(runtimeMocks.getMonacoRuntime).toHaveBeenCalledWith('dark')
    expect(monaco.editor.create).toHaveBeenCalledTimes(1)
    expect(editorOptions).toMatchObject({
      readOnly: true,
      domReadOnly: true,
      wordWrap: 'on',
      lineNumbers: 'on',
      minimap: { enabled: false },
      contextmenu: false,
    })
    expect(models).toHaveLength(1)
    expect(models[0]?.value).toBe('first line')
    expect(mounted.find('.flow-log-viewer-empty').exists()).toBe(false)
  })

  it('retains the loading, missing, and empty states while content is absent', async () => {
    const mounted = await mountViewer({ loading: true })
    expect(mounted.text()).toContain('Loading log content')
    expect(models).toHaveLength(0)

    await mounted.setProps({ loading: false, missing: true })
    expect(mounted.text()).toContain('Log file not found')

    await mounted.setProps({ missing: false })
    expect(mounted.text()).toContain('No log content yet')
  })

  it('initializes a model after content arrives late', async () => {
    const mounted = await mountViewer()
    expect(models).toHaveLength(0)

    await mounted.setProps({ content: 'first log line\nsecond log line' })
    expect(flushNextAnimationFrame()).toBe(true)

    expect(models).toHaveLength(1)
    expect(models[0]?.value).toBe('first log line\nsecond log line')
    expect(mounted.find('.flow-log-viewer-empty').exists()).toBe(false)
  })

  it('appends live content and follows the tail when already pinned', async () => {
    const mounted = await mountViewer({ content: 'first line', live: true })
    editor.scrollHeight = 300
    expect(flushNextAnimationFrame()).toBe(true)
    expect(editor.setScrollTop).toHaveBeenLastCalledWith(300)

    editor.scrollTop = 200
    await mounted.setProps({ content: 'first line\nsecond line' })
    expect(flushNextAnimationFrame()).toBe(true)
    expect(models[0]?.applyEdits).toHaveBeenLastCalledWith([
      expect.objectContaining({
        text: '\nsecond line',
        forceMoveMarkers: true,
      }),
    ])

    editor.scrollHeight = 460
    expect(flushNextAnimationFrame()).toBe(true)
    expect(editor.setScrollTop).toHaveBeenLastCalledWith(460)
  })

  it('does not pull a live log back down while the user reads older output', async () => {
    const mounted = await mountViewer({ content: 'first line', live: true })
    editor.scrollHeight = 300
    flushNextAnimationFrame()
    editor.scrollTop = 80

    await mounted.setProps({ content: 'first line\nsecond line' })
    expect(flushNextAnimationFrame()).toBe(true)

    expect(animationFrames.size).toBe(0)
    expect(editor.setScrollTop).toHaveBeenCalledTimes(1)
    expect(editor.scrollTop).toBe(80)
  })

  it('keeps a model and view state for each flow channel', async () => {
    const mounted = await mountViewer({
      channelKey: 'lint\u001fverilator',
      content: 'lint',
    })
    editor.scrollTop = 47

    await mounted.setProps({
      channelKey: 'sim\u001fverilator',
      content: 'sim',
    })
    flushNextAnimationFrame()
    editor.scrollTop = 82

    await mounted.setProps({
      channelKey: 'lint\u001fverilator',
      content: 'lint',
    })
    flushNextAnimationFrame()

    expect(models).toHaveLength(2)
    expect(editor.restoreViewState).toHaveBeenLastCalledWith({ scrollTop: 47 })
    expect(editor.scrollTop).toBe(47)
  })

  it('normalizes terminal controls and replaces non-prefix content in place', async () => {
    const escape = String.fromCharCode(27)
    const mounted = await mountViewer({
      content: `${escape}[31mERROR${escape}[0m`,
    })
    expect(models[0]?.value).toBe('ERROR')

    await mounted.setProps({ content: 'replacement' })
    flushNextAnimationFrame()

    expect(models[0]?.value).toBe('replacement')
    expect(models[0]?.applyEdits).toHaveBeenLastCalledWith([
      expect.objectContaining({ text: 'replacement', forceMoveMarkers: true }),
    ])
  })

  it('copies only the current Monaco selection through the existing clipboard path', async () => {
    const mounted = await mountViewer({ content: 'first selected last' })
    editor.selection = new FakeRange(1, 7, 1, 15)

    await mounted.find('.flow-log-viewer-editor-wrap').trigger('contextmenu', {
      clientX: 20,
      clientY: 30,
    })
    await mounted.vm.$nextTick()
    const copyButton = document.body.querySelector<HTMLButtonElement>(
      '.flow-log-context-menu-action',
    )
    expect(copyButton).not.toBeNull()
    copyButton?.click()
    await flushPromises()

    expect(copyMocks.copyFlowLogText).toHaveBeenCalledWith('selected')
  })

  it('applies theme changes and disposes the editor and every model', async () => {
    const mounted = await mountViewer({ channelKey: 'lint', content: 'lint' })
    await mounted.setProps({ channelKey: 'sim', content: 'sim' })
    flushNextAnimationFrame()

    useThemeStore().setTheme('light')
    await mounted.vm.$nextTick()
    expect(runtimeMocks.setMonacoTheme).toHaveBeenCalledWith('light')

    mounted.unmount()
    wrapper = null
    expect(editor.dispose).toHaveBeenCalledTimes(1)
    expect(models).toHaveLength(2)
    expect(models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true)
    expect(animationFrames.size).toBe(0)
  })
})
