/// <reference types="node" />

import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import source from './SoCTemplateGallery.vue?raw'

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

    this.attributes.set(name, String(value))
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

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = []
    const match = (el: FakeElement) => {
      if (selector.startsWith('.')) {
        const token = selector.slice(1)
        return el.className.split(/\s+/).filter(Boolean).includes(token)
      }
      return el.tagName.toLowerCase() === selector.toLowerCase()
    }
    const walk = (node: FakeNode) => {
      if (!(node instanceof FakeElement)) return
      if (match(node)) {
        results.push(node)
      }
      node.childNodes.forEach(walk)
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

const require = createRequire(import.meta.url)
let vueRuntime: VueRuntime | null = null
const catalogModule = {
  importSocTemplateFromJsonText: vi.fn(),
  removeImportedSocTemplate: vi.fn(),
}

async function loadVueRuntime() {
  vueRuntime ??= await import('vue')
  return vueRuntime
}

function loadGalleryComponent(vue: VueRuntime) {
  const { descriptor } = parse(source, {
    filename: 'SoCTemplateGallery.vue',
  })

  const script = compileScript(descriptor, {
    id: 'soc-template-gallery',
    inlineTemplate: true,
    templateOptions: {
      compilerOptions: {
        hoistStatic: false,
      },
    },
  })

  const transpiled = ts.transpileModule(script.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: 'SoCTemplateGallery.ts',
  })

  const moduleExports: { default?: unknown } = {}
  const customRequire = (id: string) => {
    if (id === 'vue') return vue
    if (id === '@/composables/socTemplateCatalog') return catalogModule
    return require(id)
  }

  const evaluator = new Function('require', 'exports', 'module', transpiled.outputText)
  evaluator(customRequire, moduleExports, { exports: moduleExports })

  return moduleExports.default
}

async function mountGallery(props: Record<string, unknown>) {
  const vue = await loadVueRuntime()
  const SoCTemplateGallery = loadGalleryComponent(vue)
  const container = document.createElement('div')
  document.body.appendChild(container)

  const app = vue.createApp(SoCTemplateGallery as never, props)
  app.mount(container as never)
  await vue.nextTick()

  return {
    app,
    container,
  }
}

type ButtonQueryContainer = {
  querySelectorAll(selector: string): ArrayLike<FakeElement>
}

function findButton(container: ButtonQueryContainer, label: string): FakeElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim().includes(label))
}

describe('SoCTemplateGallery', () => {
  beforeEach(() => {
    ensureDom()
    document.body.innerHTML = ''
    catalogModule.importSocTemplateFromJsonText.mockReset()
    catalogModule.removeImportedSocTemplate.mockReset()
  })

  afterEach(() => {
    restoreDomGlobals()
  })

  it('renders loading text', async () => {
    const { app, container } = await mountGallery({
      items: [],
      loading: true,
      error: null,
    })

    expect(container.textContent).toContain('Loading templates…')

    app.unmount()
  })

  it('renders error state and emits retry when clicked', async () => {
    const onRetry = vi.fn()
    const { app, container } = await mountGallery({
      items: [],
      loading: false,
      error: 'Request failed',
      onRetry,
    })

    expect(container.textContent).toContain('Request failed')

    const retryButton = findButton(container, 'Retry')
    expect(retryButton).toBeTruthy()

    retryButton?.click()
    expect(onRetry).toHaveBeenCalledTimes(1)

    app.unmount()
  })

  it('renders an empty-state message when no items are available', async () => {
    const { app, container } = await mountGallery({
      items: [],
      loading: false,
      error: null,
    })

    expect(container.textContent).toContain('No templates yet')

    app.unmount()
  })

  it('renders a populated item card and emits back and open events', async () => {
    const onBack = vi.fn()
    const onOpen = vi.fn()
    const { app, container } = await mountGallery({
      items: [
        {
          id: 'demoSoC001',
          name: 'Demo SoC',
          info: 'Reference template',
          ioPinsCount: 12,
          coreCount: 2,
          sourceLabel: 'remote:socTemplateCatalog/templates/demo.json',
          thumbnail: {
            coreSlotLeftPct: 10,
            coreSlotTopPct: 10,
            coreSlotWidthPct: 80,
            coreSlotHeightPct: 80,
            cores: [
              { leftPct: 0, topPct: 0, widthPct: 25, heightPct: 25 },
              { leftPct: 50, topPct: 50, widthPct: 25, heightPct: 25 },
            ],
          },
        },
      ],
      loading: false,
      error: null,
      onBack,
      onOpen,
    })

    expect(container.textContent).toContain('Demo SoC')
    expect(container.textContent).toContain('Reference template')
    expect(container.textContent).toContain('Remote')
    expect(container.textContent?.toLowerCase()).toContain('cores')
    expect(container.textContent).toContain('2')
    expect(container.querySelectorAll('.soc-gallery__thumb-core')).toHaveLength(2)
    const backButton = findButton(container, 'Back')
    const openButton = findButton(container, 'Open Details')
    const hideButton = findButton(container, 'Hide')

    expect(backButton).toBeTruthy()
    expect(openButton).toBeTruthy()
    expect(hideButton).toBeTruthy()

    backButton?.click()
    openButton?.click()
    hideButton?.click()

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith('demoSoC001')
    expect(catalogModule.removeImportedSocTemplate).toHaveBeenCalledWith('demoSoC001')

    app.unmount()
  })
})
