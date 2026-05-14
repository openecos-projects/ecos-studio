/// <reference types="node" />

import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ecosViewSource from './ECOSView.vue?raw'

type VueRuntime = typeof import('vue')

type GlobalKey =
  | 'document'
  | 'window'
  | 'Node'
  | 'Element'
  | 'HTMLElement'
  | 'SVGElement'
  | 'DocumentFragment'

const {
  push,
  loadRecentProjects,
  openProject,
  loadPdks,
  importPdk,
  removePdk,
} = vi.hoisted(() => ({
  push: vi.fn(),
  loadRecentProjects: vi.fn(async () => {}),
  openProject: vi.fn(async () => true),
  loadPdks: vi.fn(async () => {}),
  importPdk: vi.fn(async () => {}),
  removePdk: vi.fn(async () => {}),
}))

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

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = []
    const matches = (element: FakeElement) => {
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

async function loadVueRuntime() {
  vueRuntime ??= await import('vue')
  return vueRuntime
}

function loadECOSViewComponent(vue: VueRuntime) {
  const { descriptor } = parse(ecosViewSource, {
    filename: 'ECOSView.vue',
  })

  const script = compileScript(descriptor, {
    id: 'ecos-view',
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
    fileName: 'ECOSView.ts',
  })

  const moduleExports: { default?: any } = {}
  const customRequire = (id: string) => {
    if (id === 'vue') return vue
    if (id === 'vue-router') {
      return {
        useRouter: () => ({
          push,
        }),
      }
    }
    if (id === '../composables/useWorkspace') {
      return {
        useWorkspace: () => ({
          recentProjects: vue.ref([]),
          openProject,
          loadRecentProjects,
        }),
      }
    }
    if (id === '../composables/usePdkManager') {
      return {
        usePdkManager: () => ({
          importedPdks: vue.ref([]),
          loadPdks,
          importPdk,
          removePdk,
        }),
      }
    }
    return require(id)
  }

  const evaluator = new Function('require', 'exports', 'module', transpiled.outputText)
  evaluator(customRequire, moduleExports, { exports: moduleExports })

  return moduleExports.default
}

describe('ECOSView SoC entry card', () => {
  beforeEach(() => {
    ensureDom()
    push.mockReset()
    loadRecentProjects.mockClear()
    openProject.mockClear()
    loadPdks.mockClear()
    importPdk.mockClear()
    removePdk.mockClear()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    restoreDomGlobals()
  })

  it('marks the SoC entry as coming soon without navigating', async () => {
    const vue = await loadVueRuntime()
    const ECOSView = loadECOSViewComponent(vue)
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = vue.createApp(ECOSView)
    app.mount(container as never)
    await vue.nextTick()

    const socCard = Array.from(container.querySelectorAll('div')).find((element) => {
      return element.textContent === 'SoCRetroSoCComing Soon'
    })

    expect(socCard).toBeTruthy()
    expect(socCard?.classList.contains('cursor-default')).toBe(true)
    expect(socCard?.classList.contains('opacity-50')).toBe(true)
    socCard?.click()

    expect(push).not.toHaveBeenCalled()

    app.unmount()
  })
})
