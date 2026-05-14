/// <reference types="node" />

import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildFlowLogViewerExtensions,
  isFlowLogViewerNearTail,
} from './flowLogCodeViewer'
import flowLogCodeViewerSource from './FlowLogCodeViewer.vue?raw'
import helperSource from './flowLogCodeViewer.ts?raw'

const codemirrorMocks = vi.hoisted(() => ({
  editorViewInstances: [] as any[],
  editorTheme: vi.fn(),
  keymapOf: vi.fn(),
  lineNumbers: vi.fn(),
  search: vi.fn(),
}))

const require = createRequire(import.meta.url)

function loadFlowLogCodeViewerComponent(vue: typeof import('vue')) {
  const { descriptor } = parse(flowLogCodeViewerSource, {
    filename: 'FlowLogCodeViewer.vue',
  })

  const script = compileScript(descriptor, {
    id: 'flow-log-code-viewer',
    inlineTemplate: true,
  })

  const transpiled = ts.transpileModule(script.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: 'FlowLogCodeViewer.ts',
  })

  const moduleExports: { default?: any } = {}
  const customRequire = (id: string) => {
    if (id === 'vue') return vue
    if (id === './flowLogCodeViewer' || id === './flowLogCodeViewer.ts') {
      return {
        buildFlowLogViewerExtensions,
        FLOW_LOG_VIEWER_TAIL_THRESHOLD_PX: 16,
        isFlowLogViewerNearTail,
      }
    }
    if (id === '@codemirror/state') {
      return {
        EditorState: {
          create: (config: { doc: string }) => ({
            ...config,
            doc: {
              length: config.doc.length,
              toString: () => config.doc,
            },
          }),
          readOnly: {
            of: (value: boolean) => ({ type: 'readOnly', value }),
          },
        },
      }
    }
    if (id === '@codemirror/search') {
      return {
        search: (options: unknown) => ({ type: 'search', options }),
        searchKeymap: [{ key: 'Mod-f' }],
      }
    }
    if (id === '@codemirror/view') {
      class RuntimeEditorView {
        static editable = {
          of: (value: boolean) => ({ type: 'editable', value }),
        }

        static lineWrapping = { type: 'lineWrapping' }

        static theme = (theme: unknown) => ({ type: 'theme', theme })

        parent: any

        state: {
          doc: {
            length: number
            toString: () => string
          }
        }

        private docText = ''

        scrollDOM = {
          clientHeight: 0,
          scrollHeight: 0,
          scrollTop: 0,
        }

        destroy = vi.fn()

        dispatch = vi.fn((transaction: { changes?: { from: number, to?: number, insert: string } }) => {
          const changes = transaction.changes
          if (!changes) return

          const current = this.docText
          const next = changes.from === 0 && changes.to === current.length
            ? changes.insert
            : `${current.slice(0, changes.from)}${changes.insert}${current.slice(changes.to ?? changes.from)}`
          this.docText = next

          this.state = {
            ...this.state,
            doc: {
              length: next.length,
              toString: () => next,
            },
          }
        })

        constructor(config: { parent: HTMLElement, state: any }) {
          this.parent = config.parent
          this.state = config.state
          this.docText = config.state.doc.toString()
          codemirrorMocks.editorViewInstances.push(this)

          const editor = document.createElement('div')
          editor.className = 'cm-editor'
          this.parent.appendChild(editor)
        }
      }

      return {
        EditorView: RuntimeEditorView,
      }
    }
    return require(id)
  }

  const evaluator = new Function('require', 'exports', 'module', transpiled.outputText)
  evaluator(customRequire, moduleExports, { exports: moduleExports })

  return moduleExports.default
}

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: vi.fn((config: { doc: string }) => ({
      ...config,
      doc: {
        length: config.doc.length,
        toString: () => config.doc,
      },
    })),
    readOnly: {
      of: vi.fn((value: boolean) => ({ type: 'readOnly', value })),
    },
  },
}))

vi.mock('@codemirror/search', () => ({
  search: codemirrorMocks.search.mockImplementation((options: unknown) => ({ type: 'search', options })),
  searchKeymap: [{ key: 'Mod-f' }],
}))

vi.mock('@codemirror/view', () => {
  class MockEditorView {
    static editable = {
      of: vi.fn((value: boolean) => ({ type: 'editable', value })),
    }

    static lineWrapping = { type: 'lineWrapping' }

    static theme = codemirrorMocks.editorTheme.mockImplementation((theme: unknown) => ({ type: 'theme', theme }))

    parent: any

    state: {
      doc: {
        length: number
        toString: () => string
      }
    }

    private docText = ''

    scrollDOM = {
      clientHeight: 0,
      scrollHeight: 0,
      scrollTop: 0,
    }

    destroy = vi.fn()

    dispatch = vi.fn((transaction: { changes?: { from: number, to?: number, insert: string } }) => {
      const changes = transaction.changes
      if (!changes) return

      const current = this.docText
      const next = changes.from === 0 && changes.to === current.length
        ? changes.insert
        : `${current.slice(0, changes.from)}${changes.insert}${current.slice(changes.to ?? changes.from)}`
      this.docText = next

      this.state = {
        ...this.state,
        doc: {
          length: next.length,
          toString: () => next,
        },
      }
    })

    constructor(config: { parent: HTMLElement, state: any }) {
      this.parent = config.parent
      this.state = config.state
      this.docText = config.state.doc.toString()
      codemirrorMocks.editorViewInstances.push(this)

      const editor = document.createElement('div')
      editor.className = 'cm-editor'
      this.parent.appendChild(editor)
    }
  }

  return {
    EditorView: MockEditorView,
    keymap: {
      of: codemirrorMocks.keymapOf.mockImplementation((value: unknown) => ({ type: 'keymap', value })),
    },
    lineNumbers: codemirrorMocks.lineNumbers.mockImplementation(() => ({ type: 'lineNumbers' })),
  }
})

type GlobalKey =
  | 'document'
  | 'window'
  | 'Node'
  | 'Element'
  | 'HTMLElement'
  | 'SVGElement'
  | 'DocumentFragment'
  | 'requestAnimationFrame'
  | 'cancelAnimationFrame'

const originalGlobals = {
  document: globalThis.document,
  window: globalThis.window,
  Node: globalThis.Node,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
  SVGElement: globalThis.SVGElement,
  DocumentFragment: globalThis.DocumentFragment,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
} as const

let domInstalled = false

class FakeNode {
  parentNode: FakeElement | null = null

  childNodes: FakeNode[] = []

  constructor(public readonly nodeType: number) {}

  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }

  appendChild(node: FakeNode) {
    return this.insertBefore(node, null)
  }

  insertBefore(node: FakeNode, anchor: FakeNode | null) {
    if (node.parentNode) {
      node.parentNode.removeChild(node)
    }

    node.parentNode = this as unknown as FakeElement

    if (!anchor) {
      this.childNodes.push(node)
      return node
    }

    const index = this.childNodes.indexOf(anchor)
    if (index === -1) {
      this.childNodes.push(node)
      return node
    }

    this.childNodes.splice(index, 0, node)
    return node
  }

  removeChild(node: FakeNode) {
    const index = this.childNodes.indexOf(node)
    if (index !== -1) {
      this.childNodes.splice(index, 1)
      node.parentNode = null
    }
    return node
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.childNodes = value ? [new FakeText(value)] : []
  }
}

class FakeText extends FakeNode {
  constructor(public data: string) {
    super(3)
  }

  get textContent(): string {
    return this.data
  }

  set textContent(value: string) {
    this.data = value
  }
}

class FakeComment extends FakeNode {
  constructor(public data: string) {
    super(8)
  }

  get textContent(): string {
    return this.data
  }

  set textContent(value: string) {
    this.data = value
  }
}

class FakeElement extends FakeNode {
  readonly tagName: string

  readonly attributes = new Map<string, string>()

  readonly style: Record<string, string> = {}

  private _className = ''

  constructor(tagName: string) {
    super(1)
    this.tagName = tagName.toUpperCase()
  }

  get className(): string {
    return this._className
  }

  set className(value: string) {
    this._className = value
    if (value) {
      this.attributes.set('class', value)
    } else {
      this.attributes.delete('class')
    }
  }

  get classList() {
    const read = () => this.className.split(/\s+/).filter(Boolean)
    return {
      contains: (token: string) => read().includes(token),
      add: (...tokens: string[]) => {
        this.className = [...new Set([...read(), ...tokens])].join(' ')
      },
      remove: (...tokens: string[]) => {
        this.className = read().filter((token) => !tokens.includes(token)).join(' ')
      },
    }
  }

  get innerHTML(): string {
    return this.textContent
  }

  set innerHTML(value: string) {
    this.childNodes = value ? [new FakeText(value)] : []
  }

  setAttribute(name: string, value: string) {
    if (name === 'class') {
      this.className = value
      return
    }
    this.attributes.set(name, value)
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string) {
    if (name === 'class') {
      this.className = ''
      return
    }
    this.attributes.delete(name)
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = []
    const matches = (element: FakeElement) => {
      if (selector.startsWith('.')) {
        return element.classList.contains(selector.slice(1))
      }
      return element.tagName.toLowerCase() === selector.toLowerCase()
    }

    const walk = (node: FakeNode) => {
      if (node instanceof FakeElement) {
        if (matches(node)) {
          results.push(node)
        }
        node.childNodes.forEach(walk)
      }
    }

    this.childNodes.forEach(walk)
    return results
  }
}

function ensureDom() {
  if ((globalThis as typeof globalThis & { document?: unknown }).document) return

  const body = new FakeElement('body')
  const documentElement = new FakeElement('html')
  const fakeDocument = {
    body,
    documentElement,
    createElement: (tagName: string) => new FakeElement(tagName),
    createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    createTextNode: (text: string) => new FakeText(text),
    createComment: (text: string) => new FakeComment(text),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  }

  Object.defineProperty(globalThis, 'document', {
    value: fakeDocument,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'Node', {
    value: FakeNode,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'Element', {
    value: FakeElement,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: FakeElement,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'SVGElement', {
    value: FakeElement,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'DocumentFragment', {
    value: FakeElement,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    configurable: true,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (handle: number) => clearTimeout(handle),
    configurable: true,
  })

  domInstalled = true
}

function restoreDomGlobals() {
  if (!domInstalled) return

  const keys: GlobalKey[] = [
    'document',
    'window',
    'Node',
    'Element',
    'HTMLElement',
    'SVGElement',
    'DocumentFragment',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]

  for (const key of keys) {
    const value = originalGlobals[key]
    if (value === undefined) {
      delete (globalThis as Record<GlobalKey, unknown>)[key]
    } else {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      })
    }
  }

  domInstalled = false
}

function installManualAnimationFrames() {
  let rafId = 0
  const callbacks = new Map<number, FrameRequestCallback>()

  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: vi.fn((callback: FrameRequestCallback) => {
      const id = ++rafId
      callbacks.set(id, callback)
      return id
    }),
    configurable: true,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: vi.fn((id: number) => {
      callbacks.delete(id)
    }),
    configurable: true,
  })

  return {
    flushNextFrame() {
      const next = callbacks.entries().next().value
      if (!next) return false
      const [id, callback] = next
      callbacks.delete(id)
      callback(Date.now())
      return true
    },
    pendingFrameCount() {
      return callbacks.size
    },
  }
}

afterEach(() => {
  const doc = globalThis.document as unknown as { body?: FakeElement } | undefined
  if (doc?.body) {
    doc.body.innerHTML = ''
  }
  codemirrorMocks.editorViewInstances.length = 0
  vi.clearAllMocks()
  restoreDomGlobals()
})

describe('flowLogCodeViewer helpers', () => {
  it('creates a readonly extension bundle', () => {
    const extensions = buildFlowLogViewerExtensions()

    expect(Array.isArray(extensions)).toBe(true)
    expect(extensions.length).toBeGreaterThan(0)
  })

  it('treats only near-tail scroll positions as pinned', () => {
    expect(isFlowLogViewerNearTail({
      scrollHeight: 1000,
      scrollTop: 686,
      clientHeight: 300,
    }, 16)).toBe(true)

    expect(isFlowLogViewerNearTail({
      scrollHeight: 1000,
      scrollTop: 600,
      clientHeight: 300,
    }, 16)).toBe(false)
  })

  it('keeps the viewer full-height while reducing empty-state framing', () => {
    expect(flowLogCodeViewerSource).toContain('flow-log-viewer-shell')
    expect(flowLogCodeViewerSource).toContain('flow-log-viewer-editor')
  })

  it('renders a blinking terminal cursor while live log content is visible', () => {
    expect(flowLogCodeViewerSource).toContain('flow-log-viewer-editor-wrap')
    expect(flowLogCodeViewerSource).toContain('flow-log-terminal-cursor')
    expect(flowLogCodeViewerSource).toContain('@keyframes flow-log-cursor-blink')
  })

  it('uses roomier typography for long log reading', () => {
    expect(helperSource).toContain("fontSize: '11px'")
    expect(helperSource).toContain("lineHeight: '1.6'")
    expect(helperSource).toContain("padding: '0 16px'")
  })
})

describe('FlowLogCodeViewer async content behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes the editor after content arrives late', async () => {
    ensureDom()
    const vue = await import('vue')
    const FlowLogCodeViewer = loadFlowLogCodeViewerComponent(vue)

    const state = vue.reactive({
      content: '',
    })

    const Host = vue.defineComponent({
      setup() {
        return () => vue.h(FlowLogCodeViewer, {
          content: state.content,
          live: false,
          missing: false,
          loading: false,
        })
      },
    })

    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = vue.createApp(Host)
    app.mount(container as never)

    expect(container.querySelector('.flow-log-viewer-empty')).not.toBeNull()
    expect(container.querySelector('.cm-editor')).toBeNull()
    expect(codemirrorMocks.editorViewInstances).toHaveLength(0)

    state.content = 'first log line\nsecond log line'
    await vue.nextTick()
    await vi.advanceTimersByTimeAsync(16)
    await vue.nextTick()

    expect(container.querySelector('.flow-log-viewer-empty')).toBeNull()
    expect(container.querySelector('.flow-log-viewer-editor')).not.toBeNull()
    expect(container.querySelector('.cm-editor')).not.toBeNull()
    expect(codemirrorMocks.editorViewInstances).toHaveLength(1)

    app.unmount()
  })

  it('appends new content without reading the current CodeMirror document string', async () => {
    ensureDom()
    const vue = await import('vue')
    const FlowLogCodeViewer = loadFlowLogCodeViewerComponent(vue)

    const state = vue.reactive({
      content: 'first line',
    })
    const Host = vue.defineComponent({
      setup() {
        return () => vue.h(FlowLogCodeViewer, {
          content: state.content,
          live: true,
          missing: false,
          loading: false,
        })
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = vue.createApp(Host)
    app.mount(container as never)

    const instance = codemirrorMocks.editorViewInstances[0]
    const toStringSpy = vi.spyOn(instance.state.doc, 'toString')
    state.content = 'first line\nsecond line'
    await vue.nextTick()
    await vi.advanceTimersByTimeAsync(16)

    expect(toStringSpy).not.toHaveBeenCalled()
    expect(instance.dispatch).toHaveBeenCalledWith({
      changes: {
        from: 'first line'.length,
        insert: '\nsecond line',
      },
    })

    app.unmount()
  })

  it('scrolls live log content to the latest line on initial render', async () => {
    ensureDom()
    const raf = installManualAnimationFrames()
    const vue = await import('vue')
    const FlowLogCodeViewer = loadFlowLogCodeViewerComponent(vue)

    const Host = vue.defineComponent({
      setup() {
        return () => vue.h(FlowLogCodeViewer, {
          content: 'first line\nsecond line',
          live: true,
          missing: false,
          loading: false,
        })
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = vue.createApp(Host)
    app.mount(container as never)

    const instance = codemirrorMocks.editorViewInstances[0]
    instance.scrollDOM.clientHeight = 120
    instance.scrollDOM.scrollHeight = 420
    instance.scrollDOM.scrollTop = 0

    expect(raf.flushNextFrame()).toBe(true)
    expect(instance.scrollDOM.scrollTop).toBe(300)

    app.unmount()
  })

  it('keeps a live log pinned to the bottom while new content is appended', async () => {
    ensureDom()
    const raf = installManualAnimationFrames()
    const vue = await import('vue')
    const FlowLogCodeViewer = loadFlowLogCodeViewerComponent(vue)

    const state = vue.reactive({
      content: 'first line',
    })
    const Host = vue.defineComponent({
      setup() {
        return () => vue.h(FlowLogCodeViewer, {
          content: state.content,
          live: true,
          missing: false,
          loading: false,
        })
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = vue.createApp(Host)
    app.mount(container as never)

    const instance = codemirrorMocks.editorViewInstances[0]
    instance.scrollDOM.clientHeight = 100
    instance.scrollDOM.scrollHeight = 300
    instance.scrollDOM.scrollTop = 0

    raf.flushNextFrame()
    expect(instance.scrollDOM.scrollTop).toBe(200)

    state.content = 'first line\nsecond line'
    await vue.nextTick()

    expect(raf.flushNextFrame()).toBe(true)
    instance.scrollDOM.scrollHeight = 460
    expect(raf.flushNextFrame()).toBe(true)

    expect(instance.scrollDOM.scrollTop).toBe(360)

    app.unmount()
  })

  it('does not pull the live log back down when the user is reading older output', async () => {
    ensureDom()
    const raf = installManualAnimationFrames()
    const vue = await import('vue')
    const FlowLogCodeViewer = loadFlowLogCodeViewerComponent(vue)

    const state = vue.reactive({
      content: 'first line',
    })
    const Host = vue.defineComponent({
      setup() {
        return () => vue.h(FlowLogCodeViewer, {
          content: state.content,
          live: true,
          missing: false,
          loading: false,
        })
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = vue.createApp(Host)
    app.mount(container as never)

    const instance = codemirrorMocks.editorViewInstances[0]
    instance.scrollDOM.clientHeight = 100
    instance.scrollDOM.scrollHeight = 300
    instance.scrollDOM.scrollTop = 0

    raf.flushNextFrame()
    instance.scrollDOM.scrollTop = 80

    state.content = 'first line\nsecond line'
    await vue.nextTick()

    expect(raf.flushNextFrame()).toBe(true)
    expect(raf.pendingFrameCount()).toBe(0)
    expect(instance.scrollDOM.scrollTop).toBe(80)

    app.unmount()
  })
})
