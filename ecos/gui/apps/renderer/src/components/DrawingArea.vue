<script setup lang="ts">
import { shallowRef, markRaw, watch, ref, onUnmounted, onMounted, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { EditorContainer, type Editor } from '@/applications/editor'
import { LayerManagerPlugin } from '@/applications/editor/plugins'
import {
  ViewportAnimator,
  DrcViolationOverlay,
} from '@/applications/editor/tile'
import DrawingToolbar from './DrawingToolbar.vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useEDA } from '@/composables/useEDA'
import { useLayoutState } from '@/composables/useLayoutState'
import { isDesktopRuntime } from '@/composables/useDesktopRuntime'
import {
  deriveDrcStepPathFromLayoutJsonRelative,
  pickDrcJsonPath,
  pickLayoutJsonPath,
  resolveLayoutJsonAbsolutePath,
} from '@/composables/useLayoutTileGen'
import { parseDrcStepJson, violationToFitRect } from '@/composables/drcStepParser'
import { requestProjectPathAccess } from '@/utils/projectFs'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import { InfoEnum, StepEnum } from '@/api/type'
import { resolveWorkspaceStepInfoApi } from '@/api/workspaceResources'
import { RULER_THICKNESS } from '@/applications/editor/core/rulerConfig'
import {
  createViewJsonPerformanceHudState,
  mergeViewJsonRendererStatsIntoHudState,
  type ViewJsonPerformanceHudState,
  type ViewJsonRendererStats,
} from '@/applications/editor/view-json/overview'
import {
  VIEW_JSON_DEFAULT_DISPLAY_PRESET,
  getViewJsonEffectiveObjectDisplayMode,
  isViewJsonDisplayModeVisible,
  type ViewJsonDisplayPreset,
} from '@/applications/editor/view-json/displayPolicy'
import { ViewJsonFullRenderer } from '@/applications/editor/view-json/fullRenderer'
import { ViewJsonGeometryTileStore } from '@/applications/editor/view-json/geometryTileStore'
import {
  loadViewJsonPackageData,
  loadViewJsonRoutingDetail,
} from '@/applications/editor/view-json/packageData'
import { createViewJsonPackageDataWorker } from '@/applications/editor/view-json/packageDataWorker'
import { createViewJsonSemanticOverviewWorker } from '@/applications/editor/view-json/semanticOverviewWorker'
import {
  VIEW_JSON_OBJECT_KIND_LABELS,
  VIEW_JSON_OBJECT_KINDS,
  createViewJsonVisibilityState,
  hideAllViewJsonLayers,
  hideAllViewJsonObjectKinds,
  showAllViewJsonLayers,
  showAllViewJsonObjectKinds,
  toggleViewJsonLayer,
  toggleViewJsonObjectKind,
} from '@/applications/editor/view-json/visibility'
import {
  getEdaLayerColorCss,
  getEdaObjectKindColorCss,
} from '@/applications/editor/layout/layerPalette'
import type {
  ViewJsonLayer,
  ViewJsonObjectKind,
  ViewJsonPackageData,
  ViewJsonRenderModel,
  ViewJsonVisibilityState,
} from '@/applications/editor/view-json/types'

const route = useRoute()
const { currentProject, resourceVersions, workspaceSession } = useWorkspace()
const { getResourceUrl } = useEDA()
const layoutState = useLayoutState()

const editor = shallowRef<Editor | null>(null)
const PERFORMANCE_HUD_UPDATE_INTERVAL_MS = 250
const PERFORMANCE_PANEL_REFRESH_INTERVAL_MS = 1000

/** Resource resolver 返回的布局 JSON 相对路径，供工具栏生成瓦片 */
const layoutJsonRelativePath = ref<string | null>(null)
/** DRC 结果 JSON 相对路径：resolver 显式字段，或与布局同目录的 `drc.step.json` */
const drcJsonRelativePath = ref<string | null>(null)

/** 当前路由阶段名，用作瓦片缓存子目录 stepKey（与 handleStageChange 一致） */
const currentStepKey = computed(() => {
  const pathParts = route.path.split('/')
  return pathParts[pathParts.length - 1] || 'home'
})

interface DrawingAsyncGuard {
  isCurrent: () => boolean
}

function createDrawingAsyncGuard(expectedStep = currentStepKey.value): DrawingAsyncGuard {
  const expectedProjectPath = currentProject.value?.path ?? null
  const expectedSessionId = workspaceSession.value.sessionId
  const expectedEditor = editor.value

  return {
    isCurrent: () =>
      editor.value === expectedEditor
      && currentProject.value?.path === expectedProjectPath
      && workspaceSession.value.sessionId === expectedSessionId
      && currentStepKey.value === expectedStep,
  }
}

/** 鼠标在画布上时的 EDA/显示坐标（屏幕 → 世界 → display，与标尺一致） */
const cursorEda = ref<{ x: number; y: number } | null>(null)

let detachCanvasPointerListeners: (() => void) | null = null

function formatCursorCoord(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString()
}

function attachCanvasPointerTracking(ed: Editor): void {
  detachCanvasPointerListeners?.()
  const canvas = ed.application?.canvas as HTMLCanvasElement | undefined
  const vp = ed.view
  if (!canvas || !vp) return

  const onMove = (e: PointerEvent): void => {
    const world = vp.toWorld(e.offsetX, e.offsetY)
    const d = ed.worldToDisplay(world.x, world.y)
    cursorEda.value = { x: d.x, y: d.y }
  }
  const onLeave = (): void => {
    cursorEda.value = null
  }

  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)

  detachCanvasPointerListeners = () => {
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerleave', onLeave)
    detachCanvasPointerListeners = null
  }
}

watch(
  () => [currentProject.value?.path ?? null, currentStepKey.value] as const,
  ([projectPath], prev) => {
    const prevPath = prev?.[0] ?? null
    if (projectPath !== prevPath) {
      resetLoadingState()
    }
  },
  { immediate: true },
)

watch(
  () => editor.value,
  (ed) => {
    detachCanvasPointerListeners?.()
    cursorEda.value = null
    if (ed) attachCanvasPointerTracking(ed)
  },
  { immediate: true }
)

/** 画布底部居中、标尺上方：版图快捷键（可点击） */
const LAYOUT_HOTKEY_BAR_BOTTOM_PX = RULER_THICKNESS + 10

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
}

const showLayoutHotkeyBar = computed(() =>
  layoutState.renderMode.value === 'layout'
  && layoutState.tileActions.value != null
  && layoutState.tileSelection.value != null,
)

const hotkeyDeleteApplicable = computed(() => {
  if (layoutState.isPlacementMode.value) return false
  const t = layoutState.tileSelection.value?.type
  return t === 'instance' || t === 'segment'
})

const hotkeyCApplicable = computed(() =>
  !layoutState.isPlacementMode.value
  && layoutState.tileSelection.value?.type === 'instance'
  && layoutState.tileSelection.value.cellId != null,
)

const hotkeyRApplicable = computed(() =>
  layoutState.isPlacementMode.value
  || layoutState.tileSelection.value?.type === 'instance',
)

const hotkeyFitApplicable = computed(() => layoutState.tileSelection.value != null)

function dispatchDeleteKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
}

function dispatchBackspaceKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
}

function dispatchPlaceKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }))
}

function dispatchEscapeKey(): void {
  if (layoutState.isPlacementMode.value) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  } else {
    layoutState.tileActions.value?.clearSelection()
  }
}

function dispatchRotateKey(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }))
}

function dispatchUndoChord(): void {
  const mac = isMacPlatform()
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'z',
    bubbles: true,
    cancelable: true,
    ctrlKey: !mac,
    metaKey: mac,
  }))
}

function dispatchRedoChord(): void {
  const mac = isMacPlatform()
  if (mac) {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z',
      bubbles: true,
      cancelable: true,
      metaKey: true,
      shiftKey: true,
    }))
  } else {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'y',
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    }))
  }
}

let viewportAnimator: ViewportAnimator | null = null
let drcViolationOverlay: DrcViolationOverlay | null = null
let viewJsonFullRenderer: ViewJsonFullRenderer | null = null
let currentViewJsonRenderModel: ViewJsonRenderModel | null = null
let currentViewJsonPackageData: ViewJsonPackageData | null = null
let performanceHudTimer: ReturnType<typeof setTimeout> | null = null
let performancePanelRefreshTimer: ReturnType<typeof setTimeout> | null = null
let lastViewJsonObjectKindPanelSignature = ''

const viewJsonPerformanceHud = ref<ViewJsonPerformanceHudState>(createViewJsonPerformanceHudState())
const currentViewJsonPackage = shallowRef<ViewJsonPackageData | null>(null)
const currentViewJsonPackageRoot = ref<string | null>(null)
const previewImageRelativePath = ref<string | null>(null)
const previewImageUrl = ref<string | null>(null)
const previewModeSwitchBusy = ref(false)
const showPreviewModeToggle = computed(() =>
  previewImageRelativePath.value != null && currentViewJsonPackageRoot.value != null,
)
const canSwitchToLayoutMode = computed(() => currentViewJsonPackageRoot.value != null)
const showViewJsonPerformanceHud = computed(() =>
  import.meta.env.DEV && layoutState.renderMode.value === 'layout',
)

const stepEnumValues = Object.values(StepEnum)

function getStepEnumFromPath(path: string): StepEnum | undefined {
  return stepEnumValues.find(step => step.toLowerCase() === path.toLowerCase())
}

function resetLoadingState(): void {
  layoutState.loadingState.value = 'idle'
  layoutState.loadingMessage.value = ''
}

function formatPerformanceNumber(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '0.0'
}

function formatPerformanceInteger(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : '0'
}

function formatPerformanceMetric(visible: boolean, value: string): string {
  return visible ? value : '-'
}

function formatPerformancePercent(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '0%'
}

function formatPerformanceFps(state: ViewJsonPerformanceHudState): string {
  const fps = formatPerformanceNumber(state.fps, 0)
  if (state.frameThrottle === 'idle') {
    return `Parked (${formatPerformanceNumber(state.frameThrottleFps, 0)} cap)`
  }
  return fps
}

function isViewJsonTileHudMode(mode: string): boolean {
  return mode === 'raster' || mode === 'tiled-detail'
}

function applyRendererStatsToHud(stats: ViewJsonRendererStats | null): void {
  if (!stats) return
  viewJsonPerformanceHud.value = mergeViewJsonRendererStatsIntoHudState(
    viewJsonPerformanceHud.value,
    stats,
  )
}

function getViewJsonObjectKindPanelSignature(
  model: ViewJsonRenderModel,
  visibility: ViewJsonVisibilityState,
): string {
  const scale = viewJsonFullRenderer?.getPerformanceStats().scale ?? 1
  const scaleBucket = Number.isFinite(scale) && scale > 0
    ? Math.floor(Math.log2(scale))
    : 'invalid'
  const kindState = VIEW_JSON_OBJECT_KINDS
    .map(kind => `${kind}:${model.countsByObjectKind[kind]}:${visibility.objectKinds[kind] ? 1 : 0}`)
    .join('|')
  const routingDetailDeferred = currentViewJsonPackageData?.routingDetailAvailable ? 1 : 0
  return `${layoutState.viewJsonDisplayPreset.value}:${scaleBucket}:${routingDetailDeferred}:${kindState}`
}

function refreshViewJsonObjectKindPanelIfNeeded(
  model: ViewJsonRenderModel | null,
  visibility: ViewJsonVisibilityState | null,
  force = false,
): void {
  if (!model || !visibility) return
  const signature = getViewJsonObjectKindPanelSignature(model, visibility)
  if (!force && signature === lastViewJsonObjectKindPanelSignature) return
  lastViewJsonObjectKindPanelSignature = signature
  layoutState.tileObjectKinds.value = buildViewJsonObjectKindItems(model, visibility)
}

function stopPerformanceHudSampling(): void {
  if (performanceHudTimer) {
    clearTimeout(performanceHudTimer)
    performanceHudTimer = null
  }
}

function stopViewJsonPanelRefresh(): void {
  if (performancePanelRefreshTimer) {
    clearTimeout(performancePanelRefreshTimer)
    performancePanelRefreshTimer = null
  }
  lastViewJsonObjectKindPanelSignature = ''
}

function refreshViewJsonPanelFrame(): void {
  performancePanelRefreshTimer = null
  if (layoutState.renderMode.value !== 'layout' || !viewJsonFullRenderer) {
    stopViewJsonPanelRefresh()
    return
  }

  const current = layoutState.viewJsonVisibility.value
  const model = currentViewJsonRenderModel
  refreshViewJsonObjectKindPanelIfNeeded(model, current)
  performancePanelRefreshTimer = setTimeout(refreshViewJsonPanelFrame, PERFORMANCE_PANEL_REFRESH_INTERVAL_MS)
}

function startViewJsonPanelRefresh(): void {
  stopViewJsonPanelRefresh()
  refreshViewJsonPanelFrame()
}

function samplePerformanceHudFrame(): void {
  performanceHudTimer = null
  if (layoutState.renderMode.value !== 'layout' || !viewJsonFullRenderer) {
    stopPerformanceHudSampling()
    return
  }

  if (!showViewJsonPerformanceHud.value) {
    stopPerformanceHudSampling()
    startViewJsonPanelRefresh()
    return
  }

  const stats = viewJsonFullRenderer.getPerformanceStats()
  applyRendererStatsToHud(stats)
  const cappedFps = Math.max(1, stats.frameThrottleFps)
  const hudFps = stats.frameThrottle === 'idle' ? 0 : cappedFps
  viewJsonFullRenderer.updateAdaptiveFrameRate(cappedFps)
  viewJsonPerformanceHud.value = {
    ...viewJsonPerformanceHud.value,
    fps: hudFps,
    frameMs: hudFps > 0 ? 1000 / hudFps : 0,
  }

  performanceHudTimer = setTimeout(samplePerformanceHudFrame, PERFORMANCE_HUD_UPDATE_INTERVAL_MS)
}

function startPerformanceHudSampling(): void {
  stopPerformanceHudSampling()
  samplePerformanceHudFrame()
}

function startViewJsonPerformanceSampling(): void {
  startViewJsonPanelRefresh()
  if (!showViewJsonPerformanceHud.value) {
    stopPerformanceHudSampling()
    return
  }
  startPerformanceHudSampling()
}

function pickViewJsonPackageRoot(info: Record<string, unknown>): string | null {
  const value = info.viewJson
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isViewJsonLoadCancelled(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('cancelled')
}

const onEditorReady = (editorInstance: Editor) => {
  editor.value = editorInstance

  const layerMgrPlugin = editorInstance.getPlugin<LayerManagerPlugin>('layerManager')
  if (layerMgrPlugin) {
    layoutState.layerManager.value = markRaw(layerMgrPlugin)
  }

  const pathParts = route.path.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
}

function cleanupLayout(): void {
  stopPerformanceHudSampling()
  stopViewJsonPanelRefresh()
  viewportAnimator?.destroy()
  viewJsonFullRenderer?.destroy()

  viewportAnimator = null
  viewJsonFullRenderer = null
  currentViewJsonRenderModel = null
  currentViewJsonPackageData = null

  drcViolationOverlay?.destroy()
  drcViolationOverlay = null
  layoutState.drcOverlayReady.value = false
  layoutState.drcViolationCount.value = 0
  layoutState.drcViolations.value = []
  layoutState.focusDrcViolationByIndex.value = null
  layoutState.tileDieWorldH.value = 0

  layoutState.selectedGroups.value = []
  layoutState.dataStore.value = null
  layoutState.tileSelection.value = null
  layoutState.tileActions.value = null
  layoutState.tileLayers.value = []
  layoutState.tileLayerActions.value = null
  layoutState.tileObjectKinds.value = []
  layoutState.tileObjectKindActions.value = null
  layoutState.viewJsonVisibility.value = null
  layoutState.viewJsonDisplayPreset.value = VIEW_JSON_DEFAULT_DISPLAY_PRESET
  layoutState.viewJsonDisplayPresetActions.value = null
  layoutState.tileEditActions.value = null
  layoutState.hasUnsavedEdits.value = false
  layoutState.isPlacementMode.value = false
  layoutState.renderMode.value = 'image'
  viewJsonPerformanceHud.value = createViewJsonPerformanceHudState()
}

function clearCurrentViewJsonOverview(): void {
  currentViewJsonPackage.value = null
  currentViewJsonPackageRoot.value = null
  previewImageRelativePath.value = null
  previewImageUrl.value = null
}

function releaseCurrentViewJsonPackageCache(): void {
  currentViewJsonPackage.value = null
}

function worldCenterForViewJson(pkg: ViewJsonPackageData): { x: number; y: number } {
  return {
    x: pkg.worldWidth / 2,
    y: pkg.worldHeight / 2,
  }
}

function colorForViewJsonLayer(layer: ViewJsonLayer, index: number): string {
  return getEdaLayerColorCss(layer.name, index)
}

function buildViewJsonLayerItems(
  layers: ViewJsonLayer[],
  visibility: ViewJsonVisibilityState,
) {
  return [...layers]
    .sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id))
    .map((layer, index) => ({
      id: layer.id,
      name: layer.name,
      color: colorForViewJsonLayer(layer, index),
      alpha: 0.9,
      zOrder: layer.order ?? layer.id,
      visible: visibility.layers.get(layer.id) ?? true,
    }))
}

function buildViewJsonObjectKindItems(
  model: ViewJsonRenderModel,
  visibility: ViewJsonVisibilityState,
) {
  const routingDetailDeferred = currentViewJsonPackageData?.routingDetailAvailable ?? false
  return VIEW_JSON_OBJECT_KINDS
    .filter(kind => model.countsByObjectKind[kind] > 0)
    .map(kind => {
      const displayMode = getViewJsonEffectiveObjectDisplayMode(
        kind,
        viewJsonFullRenderer?.getPerformanceStats().scale ?? 1,
        layoutState.viewJsonDisplayPreset.value,
        routingDetailDeferred,
      )
      const userVisible = visibility.objectKinds[kind]
      const presetVisible = isViewJsonDisplayModeVisible(displayMode)
      return {
        kind,
        label: VIEW_JSON_OBJECT_KIND_LABELS[kind],
        color: getEdaObjectKindColorCss(kind),
        userVisible,
        presetVisible,
        visible: userVisible && presetVisible,
        count: model.countsByObjectKind[kind],
        displayMode,
      }
    })
}

function handleViewJsonRenderModelReady(model: ViewJsonRenderModel): void {
  currentViewJsonRenderModel = model
  const visibility = layoutState.viewJsonVisibility.value
  if (!visibility) return
  layoutState.tileLayers.value = buildViewJsonLayerItems(model.layers, visibility)
  refreshViewJsonObjectKindPanelIfNeeded(model, visibility, true)
  if (showViewJsonPerformanceHud.value) {
    applyRendererStatsToHud(viewJsonFullRenderer?.getPerformanceStats() ?? null)
  }
}

function applyViewJsonVisibility(visibility: ViewJsonVisibilityState): void {
  const model = currentViewJsonRenderModel
  if (!model) return
  layoutState.viewJsonVisibility.value = visibility
  layoutState.tileLayers.value = buildViewJsonLayerItems(model.layers, visibility)
  refreshViewJsonObjectKindPanelIfNeeded(model, visibility, true)
  viewJsonFullRenderer?.applyVisibility(visibility)
}

function setupViewJsonVisibilityControls(model: ViewJsonRenderModel): void {
  const initialVisibility = createViewJsonVisibilityState(model.layers)
  layoutState.viewJsonDisplayPreset.value = VIEW_JSON_DEFAULT_DISPLAY_PRESET
  applyViewJsonVisibility(initialVisibility)

  layoutState.viewJsonDisplayPresetActions.value = {
    setPreset: (preset: ViewJsonDisplayPreset) => {
      layoutState.viewJsonDisplayPreset.value = preset
      viewJsonFullRenderer?.setDisplayPreset(preset)
      refreshViewJsonObjectKindPanelIfNeeded(currentViewJsonRenderModel, layoutState.viewJsonVisibility.value, true)
    },
  }

  layoutState.tileLayerActions.value = {
    toggleLayer: (id: number) => {
      const current = layoutState.viewJsonVisibility.value
      if (!current) return
      applyViewJsonVisibility(toggleViewJsonLayer(current, id))
    },
    showAll: () => {
      const current = layoutState.viewJsonVisibility.value
      if (!current) return
      applyViewJsonVisibility(showAllViewJsonLayers(current))
    },
    hideAll: () => {
      const current = layoutState.viewJsonVisibility.value
      if (!current) return
      applyViewJsonVisibility(hideAllViewJsonLayers(current))
    },
  }

  layoutState.tileObjectKindActions.value = {
    toggleObjectKind: (kind: ViewJsonObjectKind) => {
      const current = layoutState.viewJsonVisibility.value
      if (!current) return
      applyViewJsonVisibility(toggleViewJsonObjectKind(current, kind))
    },
    showAll: () => {
      const current = layoutState.viewJsonVisibility.value
      if (!current) return
      applyViewJsonVisibility(showAllViewJsonObjectKinds(current))
    },
    hideAll: () => {
      const current = layoutState.viewJsonVisibility.value
      if (!current) return
      applyViewJsonVisibility(hideAllViewJsonObjectKinds(current))
    },
  }
}

function setupViewJsonLayoutActions(ed: Editor, pkg: ViewJsonPackageData): void {
  const view = ed.view
  if (!view) return

  viewportAnimator = markRaw(new ViewportAnimator(view))
  viewportAnimator.setManifest({
    version: 1,
    designName: pkg.manifest.design_name ?? 'view-json-layout',
    dbuPerMicron: pkg.dbuPerMicron,
    dieArea: {
      x: 0,
      y: 0,
      w: pkg.worldWidth,
      h: pkg.worldHeight,
    },
    tileConfig: {
      tilePixelSize: 0,
      minZ: 0,
      maxZ: 0,
      rasterMaxZ: 0,
      rasterFormat: 'png',
      vectorFormat: 'bin',
    },
    layers: [],
    cellsFile: { path: '', size: 0, hash: '' },
    globalFile: { path: '', size: 0, hash: '' },
    stats: {
      totalInstances: pkg.instances.length,
      generatedAt: '',
    },
  })

  layoutState.focusDrcViolationByIndex.value = (index: number) => {
    const list = layoutState.drcViolations.value
    const v = list[index]
    if (!v || !viewportAnimator) return
    void viewportAnimator.fitToBbox(violationToFitRect(v), 0.18, 450)
  }

  drcViolationOverlay = markRaw(new DrcViolationOverlay(view))
  drcViolationOverlay.bindViewportEvents()
  view.addChild(drcViolationOverlay)

  layoutState.tileDbuPerMicron.value = pkg.dbuPerMicron
  layoutState.tileDieWorldH.value = pkg.worldHeight
  layoutState.tileActions.value = {
    clearSelection: () => {
      layoutState.tileSelection.value = null
    },
    fitToView: () => {
      ed.fitToWorld(40, { worldCenter: worldCenterForViewJson(pkg) })
    },
  }
}

async function loadStepImagePreview(
  imagePath: string,
  guard: DrawingAsyncGuard,
): Promise<void> {
  const ed = editor.value
  if (!ed || !guard.isCurrent()) return
  cleanupLayout()
  const imageUrl = previewImageUrl.value
    ?? await getResourceUrl(imagePath, currentProject.value?.path || '')
  if (!guard.isCurrent() || editor.value !== ed) return
  previewImageUrl.value = imageUrl
  await ed.setBackgroundImage(imageUrl)
  if (!guard.isCurrent() || editor.value !== ed) return
  layoutState.tileActions.value = {
    clearSelection: () => {
      layoutState.tileSelection.value = null
    },
    fitToView: () => {
      ed.fitToWorld(10)
    },
  }
  layoutState.renderMode.value = 'image'
  layoutState.loadingState.value = 'ready'
  layoutState.loadingMessage.value = ''
  void nextTick(() => {
    editor.value?.fitToWorld(10)
    requestAnimationFrame(() => editor.value?.fitToWorld(10))
  })
}

function showViewJsonLayout(
  pkg: ViewJsonPackageData,
  guard: DrawingAsyncGuard,
): void {
  const ed = editor.value
  if (!ed?.view || !guard.isCurrent()) return

  cleanupLayout()
  currentViewJsonPackageData = pkg
  ed.clearBackground()
  previewImageUrl.value = null
  ed.setWorldBounds(pkg.worldWidth, pkg.worldHeight)
  const worldCenter = worldCenterForViewJson(pkg)
  ed.fitToWorld(40, { worldCenter })

  viewJsonFullRenderer = markRaw(new ViewJsonFullRenderer(ed.view, ed.application?.renderer ?? null, {
    onModelReady: handleViewJsonRenderModelReady,
    requestRenderActive: () => ed.requestRenderActive(),
    getFrameThrottleState: () => ed.getRenderThrottleState(),
    loadRoutingDetail: async (_data, options) => {
      const packageRoot = currentViewJsonPackageRoot.value
      const projectPath = currentProject.value?.path
      if (!packageRoot || !projectPath || !guard.isCurrent()) return null
      return loadViewJsonRoutingDetail(packageRoot, {
        projectPath,
        workerFactory: createViewJsonPackageDataWorker,
        shouldCancel: () => !guard.isCurrent() || (options?.shouldCancel?.() ?? false),
      })
    },
    semanticOverviewWorkerFactory: createViewJsonSemanticOverviewWorker,
    tileStoreFactory: (data) => {
      const packageRoot = data.packageRoot ?? currentViewJsonPackageRoot.value
      const projectPath = currentProject.value?.path
      if (!packageRoot || !projectPath || !data.geometryTileIndex) return null
      return new ViewJsonGeometryTileStore(packageRoot, data.geometryTileIndex, {
        projectPath,
        worldHeight: data.worldHeight,
      })
    },
  }))
  const model = viewJsonFullRenderer.render(pkg)
  currentViewJsonRenderModel = model
  setupViewJsonVisibilityControls(model)
  setupViewJsonLayoutActions(ed, pkg)
  void loadDrcViolationOverlayAfterTiles(ed, pkg.worldHeight, guard)

  layoutState.renderMode.value = 'layout'
  layoutState.loadingState.value = 'ready'
  layoutState.loadingMessage.value = ''
  viewJsonPerformanceHud.value = {
    ...viewJsonPerformanceHud.value,
    loadStats: pkg.loadStats,
  }
  applyRendererStatsToHud(viewJsonFullRenderer.getPerformanceStats())
  startViewJsonPerformanceSampling()

  void nextTick(() => {
    editor.value?.fitToWorld(40, { worldCenter })
    requestAnimationFrame(() => editor.value?.fitToWorld(40, { worldCenter }))
  })
}

async function loadDrcViolationOverlayAfterTiles(
  _ed: Editor,
  dieWorldH: number,
  guard: DrawingAsyncGuard = createDrawingAsyncGuard(currentStepKey.value),
): Promise<void> {
  layoutState.drcOverlayReady.value = false
  layoutState.drcViolationCount.value = 0
  layoutState.drcViolations.value = []
  if (!isDesktopRuntime() || !drcViolationOverlay) return
  const overlay = drcViolationOverlay

  const projectPath = currentProject.value?.path
  const drcRel = drcJsonRelativePath.value
  if (!projectPath || !drcRel) return

  try {
    const abs = await resolveLayoutJsonAbsolutePath(projectPath, drcRel)
    if (!guard.isCurrent() || drcViolationOverlay !== overlay) return
    if (!(await requestProjectPathAccess(abs))) return
    const text = await readOptionalProjectTextFile(abs)
    if (!guard.isCurrent() || drcViolationOverlay !== overlay) return
    if (text === null) return
    const raw = JSON.parse(text) as unknown
    const violations = parseDrcStepJson(raw, dieWorldH)
    if (!guard.isCurrent() || drcViolationOverlay !== overlay) return
    overlay.setViolations(violations)
    layoutState.drcViolations.value = violations
    layoutState.drcViolationCount.value = violations.length
    layoutState.drcOverlayReady.value = true
  } catch (e) {
    console.warn('[drc overlay] load failed:', e)
    if (!guard.isCurrent() || drcViolationOverlay !== overlay) return
    overlay.setViolations([])
    layoutState.drcViolations.value = []
  }
}

async function loadStepViewJsonOverview(
  viewJsonPackageRoot: string,
  guard: DrawingAsyncGuard = createDrawingAsyncGuard(currentStepKey.value),
): Promise<ViewJsonPackageData | null> {
  const ed = editor.value
  if (!ed?.view || !guard.isCurrent()) return null

  if (currentViewJsonPackage.value && currentViewJsonPackageRoot.value === viewJsonPackageRoot) {
    return currentViewJsonPackage.value
  }

  currentViewJsonPackage.value = null
  layoutState.loadingMessage.value = 'Loading view JSON layout...'

  try {
    const projectPath = currentProject.value?.path
    if (!projectPath) {
      throw new Error('Project path is required to load view JSON layout.')
    }
    const pkg = await loadViewJsonPackageData(viewJsonPackageRoot, {
      projectPath,
      workerFactory: createViewJsonPackageDataWorker,
      deferRoutingDetail: true,
      shouldCancel: () => !guard.isCurrent(),
    })
    if (!guard.isCurrent() || editor.value !== ed) {
      return null
    }

    currentViewJsonPackage.value = pkg
    return pkg
  } catch (err) {
    if (isViewJsonLoadCancelled(err) && !guard.isCurrent()) {
      return null
    }
    console.error('Failed to load view JSON layout:', err)
    layoutState.loadingState.value = 'error'
    layoutState.loadingMessage.value = String(err)
    cleanupLayout()
    currentViewJsonPackage.value = null
    return null
  }
}

async function onPreviewModeChange(mode: 'layout' | 'image'): Promise<void> {
  if (previewModeSwitchBusy.value || mode === layoutState.renderMode.value) return

  previewModeSwitchBusy.value = true
  const guard = createDrawingAsyncGuard(currentStepKey.value)
  layoutState.loadingState.value = 'loading'
  layoutState.loadingMessage.value = mode === 'image'
    ? 'Loading preview image...'
    : 'Loading view JSON layout...'
  try {
    if (mode === 'image') {
      const imagePath = previewImageRelativePath.value
      if (!imagePath) {
        if (guard.isCurrent()) resetLoadingState()
        return
      }
      releaseCurrentViewJsonPackageCache()
      await loadStepImagePreview(imagePath, guard)
    } else {
      const packageRoot = currentViewJsonPackageRoot.value
      if (!packageRoot) {
        if (guard.isCurrent()) resetLoadingState()
        return
      }
      const overview = await loadStepViewJsonOverview(packageRoot, guard)
      if (!overview) return
      showViewJsonLayout(overview, guard)
    }
  } catch (err) {
    console.error('Preview mode switch failed:', err)
    if (!guard.isCurrent()) return
    layoutState.loadingState.value = 'error'
    layoutState.loadingMessage.value = String(err)
  } finally {
    previewModeSwitchBusy.value = false
  }
}

const handleStageChange = async (stage: string) => {
  if (!editor.value || !stage) return
  const guard = createDrawingAsyncGuard(stage)
  resetLoadingState()

  const stepEnum = getStepEnumFromPath(stage)
  if (!stepEnum) {
    editor.value.clearBackground()
    cleanupLayout()
    clearCurrentViewJsonOverview()
    layoutJsonRelativePath.value = null
    drcJsonRelativePath.value = null
    return
  }

  try {
    const layoutResponse = await resolveWorkspaceStepInfoApi({
      step: stepEnum,
      id: InfoEnum.layout,
    })
    if (!guard.isCurrent()) return

    if (layoutResponse.response === 'available' || layoutResponse.response === 'missing') {
      const info = layoutResponse.info
      layoutJsonRelativePath.value = pickLayoutJsonPath(info)
      drcJsonRelativePath.value = pickDrcJsonPath(info)
        ?? deriveDrcStepPathFromLayoutJsonRelative(layoutJsonRelativePath.value ?? '')
        ?? null
      const imagePath = typeof info.image === 'string' && info.image.length > 0 ? info.image : null
      if (!imagePath) {
        editor.value?.clearBackground()
        cleanupLayout()
        clearCurrentViewJsonOverview()
        return
      }
      const viewJsonPackageRoot = pickViewJsonPackageRoot(info)
      cleanupLayout()
      clearCurrentViewJsonOverview()
      currentViewJsonPackageRoot.value = viewJsonPackageRoot
      previewImageRelativePath.value = imagePath
      layoutState.loadingState.value = 'loading'
      layoutState.loadingMessage.value = 'Loading preview image...'
      await loadStepImagePreview(imagePath, guard)
      return
    }

    editor.value?.clearBackground()
    cleanupLayout()
    clearCurrentViewJsonOverview()
    layoutJsonRelativePath.value = null
    drcJsonRelativePath.value = null
  } catch (error) {
    console.error('Failed to load stage results:', error)
    if (!guard.isCurrent()) return
    editor.value?.clearBackground()
    cleanupLayout()
    clearCurrentViewJsonOverview()
    layoutJsonRelativePath.value = null
    drcJsonRelativePath.value = null
    resetLoadingState()
  }
}

watch(() => route.path, (newPath) => {
  const pathParts = newPath.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
})

// CLI 运行命令完成后的兜底刷新信号。
watch(
  () => [
    resourceVersions.value.step,
    resourceVersions.value.tiles,
    resourceVersions.value.all,
  ],
  () => {
    const pathParts = route.path.split('/')
    const stage = pathParts[pathParts.length - 1] || 'home'
    handleStageChange(stage)
  }
)

function onToolChange(_toolId: string): void {
  layoutState.tileSelection.value = null
}

function handleFitToView(): void {
  const sel = layoutState.tileSelection.value
  if (!sel || !viewportAnimator) return
  viewportAnimator.fitToBbox({ x: sel.bboxX, y: sel.bboxY, w: sel.bboxW, h: sel.bboxH })
}

/** 版图选中时：F 适应选中包围盒（与 Fit 按钮一致） */
function onWindowKeyDownForLayoutFit(e: KeyboardEvent): void {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.key !== 'f' && e.key !== 'F') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (layoutState.renderMode.value !== 'layout') return
  if (!layoutState.tileSelection.value) return
  e.preventDefault()
  handleFitToView()
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeyDownForLayoutFit)
})

onUnmounted(() => {
  detachCanvasPointerListeners?.()
  cleanupLayout()
  window.removeEventListener('keydown', onWindowKeyDownForLayoutFit)
})
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <DrawingToolbar
      :editor="editor"
      :layout-tile-shortcuts-hint="layoutState.renderMode.value === 'layout' && layoutState.tileSelection.value != null"
      :show-preview-mode-toggle="showPreviewModeToggle"
      :render-mode="layoutState.renderMode.value"
      :can-switch-to-layout-mode="canSwitchToLayoutMode"
      :tile-generate-confirm-reset-key="route.path"
      :preview-mode-switch-busy="previewModeSwitchBusy"
      @toolChange="onToolChange"
      @previewModeChange="onPreviewModeChange"
    />

    <div class="relative flex-1 overflow-hidden">
      <EditorContainer @ready="onEditorReady" />

      <!-- Loading overlay -->
      <div
        v-if="layoutState.loadingState.value === 'loading'"
        class="absolute inset-0 flex items-center justify-center bg-black/40 z-10"
      >
        <div class="flex flex-col items-center gap-2 text-white/80 text-sm">
          <div class="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"></div>
          <span>{{ layoutState.loadingMessage.value || 'Loading...' }}</span>
        </div>
      </div>

      <!-- Error state -->
      <div
        v-if="layoutState.loadingState.value === 'error'"
        class="absolute bottom-4 left-4 px-3 py-2 bg-red-900/80 text-red-200 text-xs rounded z-10"
      >
        Load error: {{ layoutState.loadingMessage.value }}
      </div>

      <!-- 有选中时展示：底部居中、标尺上方，版图快捷键（可点击） -->
      <div
        v-if="showLayoutHotkeyBar"
        class="absolute left-1/2 z-30 max-w-[min(100%,56rem)] -translate-x-1/2 pointer-events-none px-3"
        :style="{ bottom: `${LAYOUT_HOTKEY_BAR_BOTTOM_PX}px` }"
      >
        <div
          class="pointer-events-auto flex flex-wrap items-center justify-center gap-x-1 gap-y-1 rounded-lg border border-(--border-color) bg-(--bg-primary)/95 px-2 py-1.5 shadow-lg"
          role="toolbar"
          aria-label="版图快捷键"
        >
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) sm:text-[11px]"
            title="放置模式：退出放置；否则：清除选中"
            @click="dispatchEscapeKey"
          >
            Esc
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyRApplicable"
            title="旋转（R）：选中 instance 原地旋转 / 放置模式切换朝向"
            @click="dispatchRotateKey"
          >
            R
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyCApplicable"
            title="选中 instance：复制 cell 并进入放置（C）"
            @click="dispatchPlaceKey"
          >
            C
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyDeleteApplicable"
            title="删除（Delete）"
            @click="dispatchDeleteKey"
          >
            Del
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyDeleteApplicable"
            title="删除（Backspace）"
            @click="dispatchBackspaceKey"
          >
            ⌫
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) sm:text-[11px]"
            title="撤销（Ctrl+Z）"
            @click="dispatchUndoChord"
          >
            {{ isMacPlatform() ? '⌘Z' : 'Ctrl+Z' }}
          </button>
          <button
            type="button"
            class="rounded border border-(--border-color) bg-(--bg-secondary) px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--bg-hover) sm:text-[11px]"
            :title="isMacPlatform() ? '重做（⇧⌘Z）' : '重做（Ctrl+Y）'"
            @click="dispatchRedoChord"
          >
            {{ isMacPlatform() ? '⇧⌘Z' : 'Ctrl+Y' }}
          </button>
          <button
            type="button"
            class="rounded border border-(--accent-color)/40 bg-(--accent-color)/15 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-(--text-primary) hover:bg-(--accent-color)/25 disabled:cursor-not-allowed disabled:opacity-40 sm:text-[11px]"
            :disabled="!hotkeyFitApplicable"
            title="适应选中（F）"
            aria-label="适应选中到视口（F）"
            @click="handleFitToView"
          >
            F
          </button>
        </div>
      </div>

      <!-- 鼠标 EDA 坐标（屏幕 → 世界 → 显示） -->
      <div
        class="absolute top-2 right-2 z-20 flex flex-col items-end gap-1 pointer-events-none"
      >
        <div
          v-if="cursorEda"
          class="rounded border border-(--border-color) bg-(--bg-primary)/90 px-2 py-1 font-mono text-[11px] text-(--text-primary) tabular-nums shadow-sm"
        >
          <span class="text-(--text-secondary)">X</span> {{ formatCursorCoord(cursorEda.x) }}
          <span class="ml-2 text-(--text-secondary)">Y</span> {{ formatCursorCoord(cursorEda.y) }}
        </div>
        <div
          v-if="showViewJsonPerformanceHud"
          data-testid="view-json-performance-hud"
          class="min-w-44 rounded border border-(--border-color) bg-(--bg-primary)/90 px-2 py-1.5 font-mono text-[10px] leading-4 text-(--text-primary) tabular-nums shadow-sm backdrop-blur"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">FPS</span>
            <span>{{ formatPerformanceFps(viewJsonPerformanceHud) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Frame</span>
            <span>{{ formatPerformanceNumber(viewJsonPerformanceHud.frameMs) }}ms</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Mode</span>
            <span class="uppercase">{{ viewJsonPerformanceHud.renderMode }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Scale</span>
            <span>{{ formatPerformanceNumber(viewJsonPerformanceHud.scale, 3) }}x</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Instances</span>
            <span>{{ formatPerformanceInteger(viewJsonPerformanceHud.visibleInstanceCount) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Chunks</span>
            <span>{{ formatPerformanceInteger(viewJsonPerformanceHud.visibleChunkCount) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Limit</span>
            <span>{{ formatPerformanceInteger(viewJsonPerformanceHud.adaptiveDetailInstanceLimit) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Tiles/Vec</span>
            <span>
              {{ formatPerformanceInteger(viewJsonPerformanceHud.activeRasterTileCount) }}
              /
              {{ formatPerformanceInteger(viewJsonPerformanceHud.activeVectorChunkCount) }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Tile Q/B/C</span>
            <span>
              {{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), formatPerformanceInteger(viewJsonPerformanceHud.pendingRasterTileCount)) }}
              /
              {{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), formatPerformanceInteger(viewJsonPerformanceHud.buildingRasterTileCount)) }}
              /
              {{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), formatPerformanceInteger(viewJsonPerformanceHud.activeRasterTileCount)) }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Hit/Miss</span>
            <span>
              {{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), formatPerformanceInteger(viewJsonPerformanceHud.rasterTileCacheHitCount)) }}
              /
              {{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), formatPerformanceInteger(viewJsonPerformanceHud.rasterTileCacheMissCount)) }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Hit%</span>
            <span>{{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), formatPerformancePercent(viewJsonPerformanceHud.rasterTileCacheHitRate)) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Fallback%</span>
            <span>{{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), formatPerformancePercent(viewJsonPerformanceHud.rasterTileFallbackRate)) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Worker</span>
            <span>{{ formatPerformanceMetric(isViewJsonTileHudMode(viewJsonPerformanceHud.renderMode), `${formatPerformanceNumber(viewJsonPerformanceHud.lastRasterTileWorkerMs)}ms`) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">GPU Cache</span>
            <span>{{ formatPerformanceMetric(viewJsonPerformanceHud.renderMode === 'gpu', formatPerformanceInteger(viewJsonPerformanceHud.gpuChunkBufferCacheSize)) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Snap</span>
            <span>
              {{ formatPerformanceNumber(viewJsonPerformanceHud.interactiveSnapshotMs) }}ms
              /
              {{ formatPerformanceInteger(viewJsonPerformanceHud.interactiveSnapshotSkippedCount) }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Rebuild</span>
            <span>{{ formatPerformanceNumber(viewJsonPerformanceHud.rebuildMs) }}ms</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Model/Idx/Q</span>
            <span>
              {{ formatPerformanceNumber(viewJsonPerformanceHud.buildModelMs ?? 0) }}
              /
              {{ formatPerformanceNumber(viewJsonPerformanceHud.buildSpatialIndexMs ?? 0) }}
              /
              {{ formatPerformanceNumber(viewJsonPerformanceHud.queryMs ?? 0) }}ms
            </span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-(--text-secondary)">Lazy/Draw</span>
            <span>
              {{ formatPerformanceNumber(viewJsonPerformanceHud.lazyMaterializeMs ?? 0) }}
              /
              {{ formatPerformanceNumber(viewJsonPerformanceHud.drawMs ?? 0) }}ms
            </span>
          </div>
          <div
            v-if="viewJsonPerformanceHud.loadStats"
            class="mt-1 border-t border-(--border-color) pt-1"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="text-(--text-secondary)">Load</span>
              <span>{{ formatPerformanceNumber(viewJsonPerformanceHud.loadStats.totalMs) }}ms</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-(--text-secondary)">R/P/X/C</span>
              <span>
                {{ formatPerformanceNumber(viewJsonPerformanceHud.loadStats.readMs, 0) }}
                /
                {{ formatPerformanceNumber(viewJsonPerformanceHud.loadStats.parseMs, 0) }}
                /
                {{ formatPerformanceNumber(viewJsonPerformanceHud.loadStats.transformMs, 0) }}
                /
                {{ formatPerformanceNumber(viewJsonPerformanceHud.loadStats.chunkMs, 0) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
