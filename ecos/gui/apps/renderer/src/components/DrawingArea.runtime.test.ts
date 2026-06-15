/// <reference types="node" />

import { createRequire } from 'node:module'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import drawingAreaSource from './DrawingArea.vue?raw'

type VueRuntime = typeof import('vue')

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
      if (!(node instanceof FakeElement)) return
      if (matches(node)) {
        results.push(node)
      }
      node.childNodes.forEach(walk)
    }

    this.childNodes.forEach(walk)
    return results
  }
}

function ensureDom(): void {
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

  const windowListeners = new Map<string, Set<(event: unknown) => void>>()
  const fakeWindow = {
    document: fakeDocument,
    navigator: { platform: 'Linux' },
    addEventListener(type: string, listener: (event: unknown) => void) {
      const listeners = windowListeners.get(type) ?? new Set()
      listeners.add(listener)
      windowListeners.set(type, listeners)
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      windowListeners.get(type)?.delete(listener)
    },
    dispatchEvent(event: { type: string }) {
      windowListeners.get(event.type)?.forEach((listener) => listener(event))
      return true
    },
  }

  Object.defineProperty(globalThis, 'document', {
    value: fakeDocument,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: fakeWindow,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'navigator', {
    value: fakeWindow.navigator,
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
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: () => undefined,
    configurable: true,
  })

  domInstalled = true
}

function restoreDomGlobals(): void {
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const require = createRequire(import.meta.url)
let vueRuntime: VueRuntime | null = null

async function loadVueRuntime(): Promise<VueRuntime> {
  vueRuntime ??= await import('vue')
  return vueRuntime
}

const viewJsonRendererConstructed = vi.fn()
const resolveWorkspaceStepInfoApi = vi.fn()
const loadViewJsonOverview = vi.fn()
const getResourceUrl = vi.fn()
const requestProjectPathAccess = vi.fn()
const readOptionalProjectTextFile = vi.fn()
const createViewJsonOverviewWorker = vi.fn()
const createViewJsonRasterTileWorker = vi.fn()

const mountedApps: Array<{ unmount: () => void }> = []

interface DrawingAreaTestState {
  route: { path: string }
  currentProject: ReturnType<VueRuntime['ref']>
  resourceVersions: ReturnType<VueRuntime['ref']>
  workspaceSession: ReturnType<VueRuntime['ref']>
  layoutState: {
    selectedGroups: ReturnType<VueRuntime['shallowRef']>
    dataStore: ReturnType<VueRuntime['shallowRef']>
    layerManager: ReturnType<VueRuntime['shallowRef']>
    layerStyleSnapshot: ReturnType<VueRuntime['shallowRef']>
    renderMode: ReturnType<VueRuntime['ref']>
    loadingState: ReturnType<VueRuntime['ref']>
    loadingMessage: ReturnType<VueRuntime['ref']>
    tileSelection: ReturnType<VueRuntime['shallowRef']>
    tileDbuPerMicron: ReturnType<VueRuntime['ref']>
    tileDieWorldH: ReturnType<VueRuntime['ref']>
    tileActions: ReturnType<VueRuntime['shallowRef']>
    tileLayers: ReturnType<VueRuntime['shallowRef']>
    tileLayerActions: ReturnType<VueRuntime['shallowRef']>
    tileEditActions: ReturnType<VueRuntime['shallowRef']>
    hasUnsavedEdits: ReturnType<VueRuntime['ref']>
    isPlacementMode: ReturnType<VueRuntime['ref']>
    drcOverlayReady: ReturnType<VueRuntime['ref']>
    drcViolationCount: ReturnType<VueRuntime['ref']>
    drcViolations: ReturnType<VueRuntime['shallowRef']>
    focusDrcViolationByIndex: ReturnType<VueRuntime['shallowRef']>
  }
  fakeEditor: ReturnType<typeof createFakeEditor>
}

function createLayoutState(vue: VueRuntime) {
  return {
    selectedGroups: vue.shallowRef([]),
    dataStore: vue.shallowRef(null),
    layerManager: vue.shallowRef(null),
    layerStyleSnapshot: vue.shallowRef({}),
    renderMode: vue.ref('image'),
    loadingState: vue.ref('idle'),
    loadingMessage: vue.ref(''),
    tileSelection: vue.shallowRef(null),
    tileDbuPerMicron: vue.ref(1000),
    tileDieWorldH: vue.ref(0),
    tileActions: vue.shallowRef(null),
    tileLayers: vue.shallowRef([]),
    tileLayerActions: vue.shallowRef(null),
    tileEditActions: vue.shallowRef(null),
    hasUnsavedEdits: vue.ref(false),
    isPlacementMode: vue.ref(false),
    drcOverlayReady: vue.ref(false),
    drcViolationCount: vue.ref(0),
    drcViolations: vue.shallowRef([]),
    focusDrcViolationByIndex: vue.shallowRef(null),
  }
}

let testState: DrawingAreaTestState | null = null

function createFakeEditor() {
  const canvas = document.createElement('canvas')
  const view = {
    toWorld: vi.fn((x: number, y: number) => ({ x, y })),
    addChild: vi.fn(),
    on: vi.fn(),
    plugins: {
      resume: vi.fn(),
    },
  }

  return {
    application: { canvas },
    view,
    getPlugin: vi.fn(() => null),
    clearBackground: vi.fn(),
    fitToWorld: vi.fn(),
    worldToDisplay: vi.fn((x: number, y: number) => ({ x, y })),
    setWorldBounds: vi.fn(),
    setBackgroundImage: vi.fn(async () => undefined),
    setPluginEnabled: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    getScale: vi.fn(() => 1),
    onTransformChange: vi.fn(() => () => undefined),
  }
}

class MockViewportAnimator {
  constructor(_view: unknown) {}

  setManifest(): void {}

  fitToBbox(): void {}

  destroy(): void {}
}

class MockDrcViolationOverlay {
  constructor(_view: unknown) {}

  bindViewportEvents(): void {}

  setViolations(): void {}

  destroy(): void {}
}

class MockViewJsonOverviewRenderer {
  constructor(_view: unknown) {
    viewJsonRendererConstructed()
  }

  render(): void {}

  getPerformanceStats() {
    return {
      renderMode: 'gpu',
      visibleInstanceCount: 1,
      visibleChunkCount: 1,
      activeRasterTileCount: 0,
      activeVectorChunkCount: 0,
      adaptiveDetailInstanceLimit: 0,
      pendingRasterTileCount: 0,
      buildingRasterTileCount: 0,
      rasterTileCacheHitCount: 0,
      rasterTileCacheMissCount: 0,
      rasterTileCacheHitRate: 0,
      rasterTileFallbackCount: 0,
      rasterTileFallbackRate: 0,
      lastRasterTileWorkerMs: 0,
      gpuChunkBufferCacheSize: 0,
      scale: 1,
      rebuildMs: 0,
    }
  }

  destroy(): void {}
}

function compileDrawingArea(vue: VueRuntime) {
  const { descriptor } = parse(drawingAreaSource, {
    filename: 'DrawingArea.vue',
  })

  const script = compileScript(descriptor, {
    id: 'drawing-area',
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
    fileName: 'DrawingArea.ts',
  })

  const moduleExports: { default?: unknown } = {}
  const customRequire = (id: string) => {
    if (id === 'vue') return vue
    if (id === 'vue-router') {
      return {
        useRoute: () => testState!.route,
      }
    }
    if (id === '@/applications/editor') {
      return {
        EditorContainer: vue.defineComponent({
          emits: ['ready'],
          setup(_, { emit }) {
            vue.onMounted(() => {
              emit('ready', testState!.fakeEditor)
            })
            return () => vue.h('div', { class: 'editor-container-stub' })
          },
        }),
      }
    }
    if (id === '@/applications/editor/plugins') {
      return {
        LayerManagerPlugin: class {},
      }
    }
    if (id === '@/applications/editor/tile') {
      return {
        ViewportAnimator: MockViewportAnimator,
        DrcViolationOverlay: MockDrcViolationOverlay,
      }
    }
    if (id === '@/applications/editor/view-json/overview') {
      return {
        createViewJsonPerformanceHudState: () => ({
          fps: 0,
          frameMs: 0,
          renderMode: 'idle',
          visibleInstanceCount: 0,
          visibleChunkCount: 0,
          activeRasterTileCount: 0,
          activeVectorChunkCount: 0,
          adaptiveDetailInstanceLimit: 0,
          pendingRasterTileCount: 0,
          buildingRasterTileCount: 0,
          rasterTileCacheHitCount: 0,
          rasterTileCacheMissCount: 0,
          rasterTileCacheHitRate: 0,
          rasterTileFallbackCount: 0,
          rasterTileFallbackRate: 0,
          lastRasterTileWorkerMs: 0,
          gpuChunkBufferCacheSize: 0,
          scale: 1,
          rebuildMs: 0,
          loadStats: null,
        }),
        loadViewJsonOverview,
        mergeViewJsonRendererStatsIntoHudState: (state: Record<string, unknown>, stats: Record<string, unknown>) => ({
          ...state,
          ...stats,
        }),
        ViewJsonOverviewRenderer: MockViewJsonOverviewRenderer,
      }
    }
    if (id === '@/applications/editor/view-json/overviewWorker') {
      return {
        createViewJsonOverviewWorker,
      }
    }
    if (id === '@/applications/editor/view-json/rasterTileWorker') {
      return {
        createViewJsonRasterTileWorker,
      }
    }
    if (id === './DrawingToolbar.vue') {
      return vue.defineComponent({
        props: [
          'showPreviewModeToggle',
          'renderMode',
          'canSwitchToLayoutMode',
        ],
        emits: ['toolChange', 'previewModeChange'],
        setup(props, { emit }) {
          return () => vue.h('div', { class: 'drawing-toolbar-stub' }, [
            vue.h('button', {
              class: 'select-tool',
              onClick: () => emit('toolChange', 'select'),
            }, 'select'),
            props.showPreviewModeToggle && vue.h('button', {
              class: 'to-layout-mode',
              disabled: props.renderMode === 'image' && !props.canSwitchToLayoutMode,
              onClick: () => emit('previewModeChange', 'layout'),
            }, 'layout'),
            props.showPreviewModeToggle && vue.h('button', {
              class: 'to-image-mode',
              onClick: () => emit('previewModeChange', 'image'),
            }, 'image'),
          ])
        },
      })
    }
    if (id === '@/composables/useWorkspace') {
      return {
        useWorkspace: () => ({
          currentProject: testState!.currentProject,
          resourceVersions: testState!.resourceVersions,
          workspaceSession: testState!.workspaceSession,
        }),
      }
    }
    if (id === '@/composables/useLayoutState') {
      return {
        useLayoutState: () => testState!.layoutState,
      }
    }
    if (id === '@/composables/useEDA') {
      return {
        useEDA: () => ({
          getResourceUrl,
        }),
      }
    }
    if (id === '@/composables/useDesktopRuntime') {
      return {
        isDesktopRuntime: () => true,
      }
    }
    if (id === '@/composables/useLayoutTileGen') {
      return {
        deriveDrcStepPathFromLayoutJsonRelative: (path: string) => `${path}.drc.step.json`,
        pickDrcJsonPath: (info: Record<string, unknown>) =>
          typeof info.drcJson === 'string' ? info.drcJson : null,
        pickLayoutJsonPath: (info: Record<string, unknown>) =>
          typeof info.json === 'string' ? info.json : null,
        resolveLayoutJsonAbsolutePath: async (projectPath: string, relative: string) =>
          `${projectPath}/${relative}`,
      }
    }
    if (id === '@/composables/drcStepParser') {
      return {
        parseDrcStepJson: () => [],
        violationToFitRect: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      }
    }
    if (id === '@/utils/projectFs') {
      return {
        requestProjectPathAccess,
      }
    }
    if (id === '@/utils/projectFiles') {
      return {
        readOptionalProjectTextFile,
      }
    }
    if (id === '@/api/type') {
      return {
        InfoEnum: {
          layout: 'layout',
        },
        StepEnum: {
          SYNTHESIS: 'Synthesis',
          DRC: 'drc',
          ROUTING: 'route',
        },
      }
    }
    if (id === '@/api/workspaceResources') {
      return {
        resolveWorkspaceStepInfoApi,
      }
    }
    if (id === '@/applications/editor/core/rulerConfig') {
      return {
        RULER_THICKNESS: 24,
      }
    }

    return require(id)
  }

  const runnableOutput = transpiled.outputText.replace(/import\.meta\.env\.DEV/g, 'true')
  const evaluator = new Function('require', 'exports', 'module', runnableOutput)
  evaluator(customRequire, moduleExports, { exports: moduleExports })

  return moduleExports.default
}

function resetTestState(vue: VueRuntime, routePath: string): void {
  testState = {
    route: vue.reactive({ path: routePath }),
    currentProject: vue.ref({ path: '/workspace/demo' }),
    resourceVersions: vue.ref({ step: 0, tiles: 0, all: 0 }),
    workspaceSession: vue.ref({ sessionId: 'session-1' }),
    layoutState: createLayoutState(vue),
    fakeEditor: createFakeEditor(),
  }

  viewJsonRendererConstructed.mockClear()
  resolveWorkspaceStepInfoApi.mockClear()
  loadViewJsonOverview.mockClear()
  getResourceUrl.mockClear()
  requestProjectPathAccess.mockClear()
  readOptionalProjectTextFile.mockClear()
  createViewJsonOverviewWorker.mockClear()
  createViewJsonRasterTileWorker.mockClear()

  if (!requestProjectPathAccess.getMockImplementation()) {
    requestProjectPathAccess.mockResolvedValue(true)
  }
  if (!readOptionalProjectTextFile.getMockImplementation()) {
    readOptionalProjectTextFile.mockResolvedValue(null)
  }
  if (!loadViewJsonOverview.getMockImplementation()) {
    loadViewJsonOverview.mockResolvedValue({
      dbuPerMicron: 1000,
      dieArea: [0, 0, 120, 80],
      coreArea: [10, 10, 110, 70],
      dieWorld: { x: 0, y: 0, w: 120, h: 80 },
      coreWorld: { x: 10, y: 10, w: 100, h: 60 },
      worldWidth: 120,
      worldHeight: 80,
      chunks: new Map(),
      rasterTileBuckets: new Map(),
      totalInstanceCount: 0,
      maxChunkInstanceCount: 1,
      loadStats: {
        readMs: 0,
        parseMs: 0,
        transformMs: 0,
        chunkMs: 0,
        totalMs: 0,
      },
    })
  }
  if (!getResourceUrl.getMockImplementation()) {
    getResourceUrl.mockImplementation(async (path: string) => `blob:${path}`)
  }
}

async function flush(vue: VueRuntime): Promise<void> {
  await Promise.resolve()
  await vue.nextTick()
  await Promise.resolve()
  await vue.nextTick()
}

async function mountDrawingArea(routePath: string) {
  ensureDom()
  const vue = await loadVueRuntime()
  resetTestState(vue, routePath)
  const DrawingArea = compileDrawingArea(vue)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const app = vue.createApp(DrawingArea as never)
  app.mount(container as never)
  mountedApps.push(app)
  await flush(vue)
  return { vue, app, container }
}

afterEach(() => {
  while (mountedApps.length > 0) {
    mountedApps.pop()?.unmount()
  }

  const doc = globalThis.document as unknown as { body?: FakeElement } | undefined
  if (doc?.body) {
    doc.body.innerHTML = ''
  }

  viewJsonRendererConstructed.mockReset()
  resolveWorkspaceStepInfoApi.mockReset()
  loadViewJsonOverview.mockReset()
  getResourceUrl.mockReset()
  requestProjectPathAccess.mockReset()
  readOptionalProjectTextFile.mockReset()
  createViewJsonOverviewWorker.mockReset()
  createViewJsonRasterTileWorker.mockReset()

  restoreDomGlobals()
})

describe('DrawingArea runtime guards', () => {
  it('loads the old step image preview and switches to view JSON layout mode on demand', async () => {
    resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        image: 'route/output/gcd_route.png',
        json: 'route/output/layout.json',
        viewJson: 'route_ecc/output/gcd_route_view',
      },
    })
    getResourceUrl
      .mockResolvedValueOnce('blob:route-output-first')
      .mockResolvedValueOnce('blob:route-output-second')

    const { vue, container } = await mountDrawingArea('/workspace/route')

    expect(getResourceUrl).toHaveBeenCalledWith(
      'route/output/gcd_route.png',
      '/workspace/demo',
    )
    expect(testState!.fakeEditor.setBackgroundImage).toHaveBeenCalledWith('blob:route-output-first')
    expect(loadViewJsonOverview).not.toHaveBeenCalled()
    expect(viewJsonRendererConstructed).not.toHaveBeenCalled()
    expect(testState!.layoutState.renderMode.value).toBe('image')

    ;(container.querySelector('.to-layout-mode') as FakeElement | null)?.click()
    await flush(vue)

    expect(loadViewJsonOverview).toHaveBeenCalledWith(
      'route_ecc/output/gcd_route_view',
      {
        projectPath: '/workspace/demo',
        shouldCancel: expect.any(Function),
        workerFactory: createViewJsonOverviewWorker,
      },
    )
    expect(testState!.fakeEditor.clearBackground).toHaveBeenCalled()
    expect(viewJsonRendererConstructed).toHaveBeenCalledTimes(1)
    expect(testState!.layoutState.renderMode.value).toBe('layout')

    ;(container.querySelector('.to-image-mode') as FakeElement | null)?.click()
    await flush(vue)

    expect(getResourceUrl).toHaveBeenCalledTimes(2)
    expect(testState!.fakeEditor.setBackgroundImage).toHaveBeenCalledTimes(2)
    expect(testState!.fakeEditor.setBackgroundImage).toHaveBeenLastCalledWith('blob:route-output-second')
    expect(testState!.layoutState.renderMode.value).toBe('image')
  })

  it('loads the old step image preview without exposing layout mode when view JSON is missing', async () => {
    resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'missing',
      info: {
        image: 'synth/output/gcd_synth.png',
        json: 'synth/output/layout.json',
      },
      missing: ['synth/output/gcd_synth_view'],
    })
    getResourceUrl.mockResolvedValue('blob:synth-output')

    const { container } = await mountDrawingArea('/workspace/Synthesis')

    expect(getResourceUrl).toHaveBeenCalledWith(
      'synth/output/gcd_synth.png',
      '/workspace/demo',
    )
    expect(testState!.fakeEditor.setBackgroundImage).toHaveBeenCalledWith('blob:synth-output')
    expect(testState!.layoutState.loadingState.value).toBe('ready')
    expect(testState!.layoutState.renderMode.value).toBe('image')
    expect(loadViewJsonOverview).not.toHaveBeenCalled()
    expect(viewJsonRendererConstructed).not.toHaveBeenCalled()
    expect(container.querySelector('.to-layout-mode')).toBeNull()
  })

  it('does not let a stale preview image load from the previous route overwrite the current stage', async () => {
    const staleImage = deferred<string>()
    resolveWorkspaceStepInfoApi.mockImplementation(async ({ step }: { step: string }) => {
      if (step === 'Synthesis') {
        return {
          response: 'available',
          info: {
            image: 'synth/output/gcd_synth.png',
            json: 'synth/output/layout.json',
            viewJson: 'Synthesis_yosys/output/gcd_Synthesis_view',
          },
        }
      }

      return {
        response: 'available',
        info: {
          image: 'drc/output/gcd_drc.png',
          json: 'drc/output/layout.json',
          viewJson: 'drc_ecc/output/gcd_drc_view',
        },
      }
    })
    getResourceUrl.mockImplementation(async (path: string) => {
      if (path === 'synth/output/gcd_synth.png') return await staleImage.promise
      return `blob:${path}`
    })

    const { vue } = await mountDrawingArea('/workspace/Synthesis')

    testState!.route.path = '/workspace/drc'
    await flush(vue)

    expect(testState!.fakeEditor.setBackgroundImage).toHaveBeenCalledWith('blob:drc/output/gcd_drc.png')
    expect(loadViewJsonOverview).not.toHaveBeenCalled()
    expect(viewJsonRendererConstructed).not.toHaveBeenCalled()
    expect(testState!.layoutState.renderMode.value).toBe('image')

    staleImage.resolve('blob:synth/output/gcd_synth.png')
    await flush(vue)

    expect(testState!.fakeEditor.setBackgroundImage).toHaveBeenCalledTimes(1)
    expect(viewJsonRendererConstructed).not.toHaveBeenCalled()
    expect(testState!.layoutState.renderMode.value).toBe('image')
  })

  it('ignores a stale preview image completion after the workspace session changes', async () => {
    const imageLoad = deferred<string>()
    resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        image: 'route/output/gcd_route.png',
        json: 'route/output/layout.json',
        viewJson: 'route_ecc/output/gcd_route_view',
      },
    })
    getResourceUrl.mockReturnValue(imageLoad.promise)

    const { vue } = await mountDrawingArea('/workspace/Synthesis')

    testState!.workspaceSession.value = {
      sessionId: 'session-2',
    }

    imageLoad.resolve('blob:route/output/gcd_route.png')
    await flush(vue)

    expect(viewJsonRendererConstructed).not.toHaveBeenCalled()
    expect(testState!.fakeEditor.setWorldBounds).not.toHaveBeenCalled()
    expect(testState!.fakeEditor.setBackgroundImage).not.toHaveBeenCalled()
    expect(testState!.layoutState.renderMode.value).toBe('image')
  })

  it('cancels stale view JSON layout loading without surfacing an error', async () => {
    resolveWorkspaceStepInfoApi.mockResolvedValue({
      response: 'available',
      info: {
        image: 'route/output/gcd_route.png',
        json: 'route/output/layout.json',
        viewJson: 'route_ecc/output/gcd_route_view',
      },
    })
    loadViewJsonOverview.mockImplementation(async (_root: string, options: { shouldCancel?: () => boolean }) => {
      await Promise.resolve()
      if (options.shouldCancel?.()) {
        throw new Error('View JSON load cancelled.')
      }
      return {
        dbuPerMicron: 1000,
        dieArea: [0, 0, 120, 80],
        coreArea: null,
        dieWorld: { x: 0, y: 0, w: 120, h: 80 },
        coreWorld: null,
        worldWidth: 120,
        worldHeight: 80,
        chunks: new Map(),
        rasterTileBuckets: new Map(),
        totalInstanceCount: 0,
        maxChunkInstanceCount: 1,
        loadStats: {
          readMs: 0,
          parseMs: 0,
          transformMs: 0,
          chunkMs: 0,
          totalMs: 0,
        },
      }
    })

    const { vue, container } = await mountDrawingArea('/workspace/route')

    ;(container.querySelector('.to-layout-mode') as FakeElement | null)?.click()
    testState!.workspaceSession.value = {
      sessionId: 'session-2',
    }
    await flush(vue)

    expect(loadViewJsonOverview).toHaveBeenCalledWith(
      'route_ecc/output/gcd_route_view',
      {
        projectPath: '/workspace/demo',
        shouldCancel: expect.any(Function),
        workerFactory: createViewJsonOverviewWorker,
      },
    )
    expect(viewJsonRendererConstructed).not.toHaveBeenCalled()
    expect(testState!.fakeEditor.setWorldBounds).not.toHaveBeenCalled()
    expect(testState!.layoutState.loadingState.value).not.toBe('error')
    expect(testState!.layoutState.renderMode.value).toBe('image')
  })
})
