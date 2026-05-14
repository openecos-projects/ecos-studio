/// <reference types="node" />

import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import gallerySource from '@/components/SoCTemplateGallery.vue?raw'
import viewSource from './SoCTemplateGalleryView.vue?raw'

type VueRuntime = typeof import('vue')

type GlobalKey =
  | 'document'
  | 'window'
  | 'Node'
  | 'Element'
  | 'HTMLElement'
  | 'SVGElement'
  | 'DocumentFragment'

const { push, loadSocTemplateCatalog } = vi.hoisted(() => ({
  push: vi.fn(),
  loadSocTemplateCatalog: vi.fn(),
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
    const normalizedSelector = selector.toLowerCase()
    const walk = (node: FakeNode) => {
      if (!(node instanceof FakeElement)) return
      if (node.tagName.toLowerCase() === normalizedSelector) {
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

async function loadVueRuntime() {
  vueRuntime ??= await import('vue')
  return vueRuntime
}

function compileComponent(source: string, filename: string, id: string, vue: VueRuntime, extraModules: Record<string, unknown> = {}) {
  const { descriptor } = parse(source, { filename })
  const script = compileScript(descriptor, {
    id,
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
    fileName: `${id}.ts`,
  })

  const moduleExports: { default?: unknown } = {}
  const customRequire = (moduleId: string) => {
    if (moduleId === 'vue') return vue
    if (moduleId in extraModules) return extraModules[moduleId]
    return require(moduleId)
  }

  const evaluator = new Function('require', 'exports', 'module', transpiled.outputText)
  evaluator(customRequire, moduleExports, { exports: moduleExports })

  return moduleExports.default
}

async function mountView() {
  const vue = await loadVueRuntime()
  const socCatalogModule = {
    loadSocTemplateCatalog,
    importSocTemplateFromJsonText: vi.fn(),
    removeImportedSocTemplate: vi.fn(),
  }
  const SoCTemplateGallery = compileComponent(
    gallerySource,
    'SoCTemplateGallery.vue',
    'soc-template-gallery',
    vue,
    {
      '@/composables/socTemplateCatalog': socCatalogModule,
    },
  )
  const SoCTemplateGalleryView = compileComponent(
    viewSource,
    'SoCTemplateGalleryView.vue',
    'soc-template-gallery-view',
    vue,
    {
      'vue-router': {
        useRouter: () => ({
          push,
        }),
      },
      '@/components/SoCTemplateGallery.vue': SoCTemplateGallery,
      '@/composables/socTemplateCatalog': socCatalogModule,
    },
  )

  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = vue.createApp(SoCTemplateGalleryView as never)
  app.mount(container as never)
  await flush(vue)

  return {
    app,
    container,
    vue,
  }
}

async function flush(vue: VueRuntime) {
  await Promise.resolve()
  await vue.nextTick()
  await Promise.resolve()
  await vue.nextTick()
}

type ButtonQueryContainer = {
  querySelectorAll(selector: string): ArrayLike<FakeElement>
}

function findButton(container: ButtonQueryContainer, label: string): FakeElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim().includes(label))
}

describe('SoCTemplateGalleryView', () => {
  beforeEach(() => {
    ensureDom()
    document.body.innerHTML = ''
    push.mockReset()
    loadSocTemplateCatalog.mockReset()
  })

  afterEach(() => {
    restoreDomGlobals()
  })

  it('loads the catalog on mount and renders gallery items on success', async () => {
    loadSocTemplateCatalog.mockResolvedValue([
      {
        id: 'demoSoC001',
        name: 'Demo SoC',
        info: 'Reference template',
        ioPinsCount: 12,
        coreCount: 2,
        sourceLabel: 'fixture.json',
      },
    ])

    const { app, container } = await mountView()

    expect(loadSocTemplateCatalog).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Demo SoC')
    expect(container.textContent).toContain('Reference template')

    app.unmount()
  })

  it('routes to the detail page when an item is opened', async () => {
    loadSocTemplateCatalog.mockResolvedValue([
      {
        id: 'demoSoC001',
        name: 'Demo SoC',
        info: 'Reference template',
        ioPinsCount: 12,
        coreCount: 2,
        sourceLabel: 'fixture.json',
      },
    ])

    const { app, container } = await mountView()

    const openButton = findButton(container, 'Open Details')
    expect(openButton).toBeTruthy()

    openButton?.click()

    expect(push).toHaveBeenCalledWith({ name: 'SoCTemplateDetail', params: { templateId: 'demoSoC001' } })

    app.unmount()
  })

  it('routes home when back is clicked', async () => {
    loadSocTemplateCatalog.mockResolvedValue([])

    const { app, container } = await mountView()

    const backButton = findButton(container, 'Back')
    expect(backButton).toBeTruthy()

    backButton?.click()

    expect(push).toHaveBeenCalledWith('/')

    app.unmount()
  })

  it('retries catalog loading after a failure', async () => {
    loadSocTemplateCatalog
      .mockRejectedValueOnce(new Error('Unable to reach catalog'))
      .mockResolvedValueOnce([
        {
          id: 'demoSoC001',
          name: 'Demo SoC',
          info: 'Reference template',
          ioPinsCount: 12,
          coreCount: 2,
          sourceLabel: 'fixture.json',
        },
      ])

    const { app, container, vue } = await mountView()

    expect(container.textContent).toContain('Unable to reach catalog')

    const retryButton = findButton(container, 'Retry')
    expect(retryButton).toBeTruthy()

    retryButton?.click()
    await flush(vue)

    expect(loadSocTemplateCatalog).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Demo SoC')

    app.unmount()
  })
})
