/// <reference types="node" />

import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import chooserSource from './FlowLogStepChooser.vue?raw'

type ChooserItem = {
  key: string
  stepName: string
  state: string
  failed: boolean
  live: boolean
}

type VueRuntime = typeof import('vue')

type GlobalKey =
  | 'document'
  | 'window'
  | 'Node'
  | 'Element'
  | 'HTMLElement'
  | 'SVGElement'
  | 'DocumentFragment'

const originalGlobals = {
  document: globalThis.document,
  window: globalThis.window,
  Node: globalThis.Node,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
  SVGElement: globalThis.SVGElement,
  DocumentFragment: globalThis.DocumentFragment,
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

  readonly listeners = new Map<string, Set<(event: unknown) => void>>()

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

  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: { type: string }) {
    this.listeners.get(event.type)?.forEach((listener) => listener(event))
    return true
  }

  click() {
    this.dispatchEvent({ type: 'click' })
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

ensureDom()

const require = createRequire(import.meta.url)
let vueRuntime: VueRuntime | null = null

async function loadVueRuntime() {
  vueRuntime ??= await import('vue')
  return vueRuntime
}

function createVirtualScrollerStub(vue: VueRuntime) {
  return vue.defineComponent({
    name: 'VirtualScroller',
    props: {
      items: {
        type: Array as () => ChooserItem[],
        default: () => [],
      },
    },
    setup(props, { slots }) {
      return () =>
        vue.h(
          'div',
          { class: 'virtual-scroller-stub' },
          (props.items ?? []).map((item) => slots.item?.({ item })),
        )
    },
  })
}

function loadChooserComponent(vue: VueRuntime) {
  const { descriptor } = parse(chooserSource, {
    filename: 'FlowLogStepChooser.vue',
  })

  const script = compileScript(descriptor, {
    id: 'flow-log-step-chooser',
    inlineTemplate: true,
  })

  const moduleCode = script.content
  const transpiled = ts.transpileModule(moduleCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: 'FlowLogStepChooser.ts',
  })

  const moduleExports: { default?: any; render?: any } = {}
  const customRequire = (id: string) => {
    if (id === 'vue') return vue
    if (id === 'primevue/virtualscroller') return createVirtualScrollerStub(vue)
    return require(id)
  }

  const evaluator = new Function('require', 'exports', 'module', transpiled.outputText)
  evaluator(customRequire, moduleExports, { exports: moduleExports })

  const component = moduleExports.default

  return component
}

afterEach(() => {
  const doc = globalThis.document as unknown as { body?: FakeElement } | undefined
  if (doc?.body) {
    doc.body.innerHTML = ''
  }
  restoreDomGlobals()
})

async function mountChooser(props: {
  items: ChooserItem[]
  selectedKey: string | null
  liveKey: string | null
  onClose?: () => void
  onJumpLive?: () => void
  onSelect?: (key: string) => void
}) {
  ensureDom()
  const vue = await loadVueRuntime()
  const container = (globalThis.document as unknown as { createElement: (tagName: string) => FakeElement }).createElement('div')
  ;(globalThis.document as unknown as { body: FakeElement }).body.appendChild(container)

  const FlowLogStepChooser = loadChooserComponent(vue)
  const app = vue.createApp(FlowLogStepChooser, {
    items: props.items,
    selectedKey: props.selectedKey,
    liveKey: props.liveKey,
    onClose: props.onClose,
    onJumpLive: props.onJumpLive,
    onSelect: props.onSelect,
  })
  app.mount(container as never)

  return { app, container }
}

describe('FlowLogStepChooser', () => {
  it('emits close and select from the rendered controls', async () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    const { app, container } = await mountChooser({
      items: [
        { key: 'alpha', stepName: 'Alpha', state: 'done', failed: false, live: false },
        { key: 'beta', stepName: 'Beta', state: 'running', failed: false, live: false },
      ],
      selectedKey: 'alpha',
      liveKey: null,
      onClose,
      onSelect,
    })

    container.querySelector('.flow-log-step-chooser-close')?.click()
    container.querySelectorAll('.flow-log-step-chooser-item')[1]?.click()

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('beta')

    app.unmount()
  })

  it('shows jump to live only when it differs from the selected item and emits it on click', async () => {
    const onJumpLive = vi.fn()
    const { app: firstApp, container: firstContainer } = await mountChooser({
      items: [{ key: 'alpha', stepName: 'Alpha', state: 'done', failed: false, live: true }],
      selectedKey: 'alpha',
      liveKey: 'alpha',
      onJumpLive,
    })

    expect(firstContainer.querySelector('.flow-log-step-chooser-live-btn')).toBeNull()
    firstApp.unmount()

    const { app, container } = await mountChooser({
      items: [
        { key: 'alpha', stepName: 'Alpha', state: 'done', failed: false, live: false },
        { key: 'beta', stepName: 'Beta', state: 'running', failed: false, live: true },
      ],
      selectedKey: 'alpha',
      liveKey: 'beta',
      onJumpLive,
    })

    container.querySelector('.flow-log-step-chooser-live-btn')?.click()

    expect(onJumpLive).toHaveBeenCalledTimes(1)

    app.unmount()
  })

  it('applies selected, failed, and live classes to the rendered items', async () => {
    const { app, container } = await mountChooser({
      items: [
        { key: 'alpha', stepName: 'Alpha', state: 'done', failed: false, live: false },
        { key: 'beta', stepName: 'Beta', state: 'failed', failed: true, live: false },
        { key: 'gamma', stepName: 'Gamma', state: 'running', failed: false, live: true },
      ],
      selectedKey: 'gamma',
      liveKey: 'gamma',
    })

    const buttons = Array.from(container.querySelectorAll('.flow-log-step-chooser-item'))
    const alpha = buttons[0] as FakeElement
    const beta = buttons[1] as FakeElement
    const gamma = buttons[2] as FakeElement

    expect(alpha.classList.contains('selected')).toBe(false)
    expect(beta.classList.contains('failed')).toBe(true)
    expect(gamma.classList.contains('selected')).toBe(true)
    expect(gamma.classList.contains('live')).toBe(true)

    app.unmount()
  })
})
