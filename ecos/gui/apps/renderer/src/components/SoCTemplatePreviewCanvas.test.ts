/// <reference types="node" />

import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SocTemplateDetail, SocTemplateRect } from '@/composables/socTemplateMapper'
import source from './SoCTemplatePreviewCanvas.vue?raw'

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
    return this.childNodes.map(child => child.textContent).join('')
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
        this.className = read().filter(token => !tokens.includes(token)).join(' ')
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

    this.attributes.set(name, String(value))
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  getAttributeNames() {
    return [...this.attributes.keys()]
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
    this.listeners.get(event.type)?.forEach(listener => listener(event))
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

const require = createRequire(import.meta.url)
let vueRuntime: VueRuntime | null = null
const mountedApps: Array<{ unmount: () => void }> = []

async function loadVueRuntime() {
  vueRuntime ??= await import('vue')
  return vueRuntime
}

async function loadPreviewCanvasComponent(vue: VueRuntime) {
  const previewRendererModule = await import('@/composables/socTemplatePreviewRenderer')

  const { descriptor } = parse(source, {
    filename: 'SoCTemplatePreviewCanvas.vue',
  })

  const script = compileScript(descriptor, {
    id: 'soc-template-preview-canvas',
    inlineTemplate: true,
  })

  const transpiled = ts.transpileModule(script.content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
      esModuleInterop: true,
    },
    fileName: 'SoCTemplatePreviewCanvas.ts',
  })

  const moduleExports: { default?: unknown } = {}
  const customRequire = (id: string) => {
    if (id === 'vue') return vue
    if (id === '@/composables/socTemplatePreviewRenderer') return previewRendererModule
    return require(id)
  }

  const evaluator = new Function('require', 'exports', 'module', transpiled.outputText)
  evaluator(customRequire, moduleExports, { exports: moduleExports })

  return moduleExports.default
}

function createRect({
  llx,
  lly,
  urx,
  ury,
}: Pick<SocTemplateRect, 'llx' | 'lly' | 'urx' | 'ury'>): SocTemplateRect {
  return {
    llx,
    lly,
    urx,
    ury,
    width: urx - llx,
    height: ury - lly,
  }
}

function createTemplate(cores: SocTemplateDetail['cores']): SocTemplateDetail {
  return {
    id: 'soc-template',
    name: 'soc-template',
    info: 'fixture',
    ioPinsCount: 0,
    coreCount: cores.length,
    sourceLabel: 'fixture',
    dbu: 1000,
    die: createRect({ llx: 0, lly: 0, urx: 100, ury: 100 }),
    coreArea: createRect({ llx: 10, lly: 10, urx: 90, ury: 90 }),
    cores,
    ioPins: [],
  }
}

function getRenderedCoreIds(container: FakeElement): string[] {
  return container
    .querySelectorAll('.soc-template-preview-canvas__core')
    .map(button => button.getAttribute('data-soc-core-id') ?? '')
}

async function mountPreviewCanvas(props: {
  template: SocTemplateDetail
  selectedCoreId: number | null
  onSelectCore?: (coreId: number) => void
}) {
  ensureDom()
  const vue = await loadVueRuntime()
  const SoCTemplatePreviewCanvas = await loadPreviewCanvasComponent(vue)
  const container = document.createElement('div')
  document.body.appendChild(container)

  const Host = vue.defineComponent({
    setup() {
      return () =>
        vue.h(SoCTemplatePreviewCanvas as never, {
          template: props.template,
          selectedCoreId: props.selectedCoreId,
          onSelectCore: props.onSelectCore,
        })
    },
  })

  const app = vue.createApp(Host)
  app.mount(container as never)
  mountedApps.push(app)
  await vue.nextTick()

  return { app, container: container as unknown as FakeElement }
}

afterEach(() => {
  while (mountedApps.length > 0) {
    mountedApps.pop()?.unmount()
  }

  const doc = globalThis.document as unknown as { body?: FakeElement } | undefined
  if (doc?.body) {
    doc.body.innerHTML = ''
  }

  restoreDomGlobals()
})

describe('SoCTemplatePreviewCanvas', () => {
  it('renders only valid selectable core buttons and marks the selected core', async () => {
    const { app, container } = await mountPreviewCanvas({
      template: createTemplate([
        {
          id: 11,
          name: 'cluster/alpha',
          info: 'alpha',
          align: 'N',
          orient: 'R0',
          boundingBox: createRect({ llx: 10, lly: 50, urx: 40, ury: 80 }),
        },
        {
          id: -1,
          name: 'cluster/invalid-negative',
          info: 'invalid',
          align: 'N',
          orient: 'R0',
          boundingBox: createRect({ llx: 42, lly: 50, urx: 58, ury: 80 }),
        },
        {
          id: Number.NaN,
          name: 'cluster/invalid-nan',
          info: 'invalid',
          align: 'N',
          orient: 'R0',
          boundingBox: createRect({ llx: 60, lly: 50, urx: 70, ury: 80 }),
        },
        {
          id: 12,
          name: 'cluster/beta',
          info: 'beta',
          align: 'S',
          orient: 'R0',
          boundingBox: createRect({ llx: 20, lly: 20, urx: 70, ury: 45 }),
        },
      ]),
      selectedCoreId: 12,
    })

    const buttons = container.querySelectorAll('.soc-template-preview-canvas__core')
    expect(getRenderedCoreIds(container)).toEqual(['11', '12'])
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.classList.contains('is-selected')).toBe(false)
    expect(buttons[1]?.classList.contains('is-selected')).toBe(true)

    app.unmount()
    mountedApps.pop()
  })

  it('emits select-core for a clicked valid core id', async () => {
    const onSelectCore = vi.fn()
    const { app, container } = await mountPreviewCanvas({
      template: createTemplate([
        {
          id: 11,
          name: 'cluster/alpha',
          info: 'alpha',
          align: 'N',
          orient: 'R0',
          boundingBox: createRect({ llx: 10, lly: 50, urx: 40, ury: 80 }),
        },
        {
          id: -1,
          name: 'cluster/invalid-negative',
          info: 'invalid',
          align: 'N',
          orient: 'R0',
          boundingBox: createRect({ llx: 42, lly: 50, urx: 58, ury: 80 }),
        },
      ]),
      selectedCoreId: null,
      onSelectCore,
    })

    const buttons = container.querySelectorAll('.soc-template-preview-canvas__core')
    expect(buttons).toHaveLength(1)

    buttons[0]?.click()

    expect(onSelectCore).toHaveBeenCalledTimes(1)
    expect(onSelectCore).toHaveBeenCalledWith(11)

    app.unmount()
    mountedApps.pop()
  })

  it('suppresses rendering when every core id is invalid', async () => {
    const onSelectCore = vi.fn()
    const { app, container } = await mountPreviewCanvas({
      template: createTemplate([
        {
          id: -1,
          name: 'cluster/invalid-negative',
          info: 'invalid',
          align: 'N',
          orient: 'R0',
          boundingBox: createRect({ llx: 12, lly: 52, urx: 32, ury: 78 }),
        },
        {
          id: Number.NaN,
          name: 'cluster/invalid-nan',
          info: 'invalid',
          align: 'S',
          orient: 'R0',
          boundingBox: createRect({ llx: 36, lly: 24, urx: 66, ury: 44 }),
        },
      ]),
      selectedCoreId: -1,
      onSelectCore,
    })

    expect(container.querySelectorAll('.soc-template-preview-canvas__core')).toHaveLength(0)
    expect(onSelectCore).not.toHaveBeenCalled()

    app.unmount()
    mountedApps.pop()
  })
})
