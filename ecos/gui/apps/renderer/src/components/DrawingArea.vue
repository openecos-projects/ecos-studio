<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { EditorContainer, type Editor } from '@/applications/editor'
import DrawingToolbar from './DrawingToolbar.vue'
import { InfoEnum, StepEnum } from '@/api/type'
import { resolveWorkspaceStepInfoApi } from '@/api/workspaceResources'
import { useWorkspace } from '@/composables/useWorkspace'
import { useEDA } from '@/composables/useEDA'
import { isDesktopRuntime } from '@/composables/useDesktopRuntime'
import { getDesktopApi } from '@/platform/desktop'

const route = useRoute()
const { currentProject, resourceVersions, workspaceSession } = useWorkspace()
const { getResourceUrl } = useEDA()

const editor = shallowRef<Editor | null>(null)
const currentViewJsonPackageRoot = ref<string | null>(null)
const previewImageUrl = ref<string | null>(null)
const loadingState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const loadingMessage = ref('')
const cursorEda = ref<{ x: number; y: number } | null>(null)
const nativeLayoutViewerBusy = ref(false)

const NATIVE_LAYOUT_VIEWER_LOADING_MESSAGE = 'Preparing Native Layout Viewer...'

const currentStepKey = computed(() => {
  const pathParts = route.path.split('/')
  return pathParts[pathParts.length - 1] || 'home'
})

const isPreparingNativeLayoutViewer = computed(() =>
  nativeLayoutViewerBusy.value && loadingState.value === 'loading',
)

const showNativeLayoutViewer = computed(() =>
  isDesktopRuntime()
  && currentProject.value?.path != null
  && currentViewJsonPackageRoot.value != null,
)

const stepEnumValues = Object.values(StepEnum)
let detachCanvasPointerListeners: (() => void) | null = null

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

function getStepEnumFromPath(path: string): StepEnum | undefined {
  return stepEnumValues.find(step => step.toLowerCase() === path.toLowerCase())
}

function pickViewJsonPackageRoot(info: Record<string, unknown>): string | null {
  const value = info.viewJson
  return typeof value === 'string' && value.length > 0 ? value : null
}

function resetLoadingState(): void {
  loadingState.value = 'idle'
  loadingMessage.value = ''
}

function clearCurrentPreview(): void {
  currentViewJsonPackageRoot.value = null
  previewImageUrl.value = null
}

function formatCursorCoord(n: number): string {
  if (!Number.isFinite(n)) return '-'
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

async function loadStepImagePreview(
  imagePath: string,
  guard: DrawingAsyncGuard,
): Promise<void> {
  const ed = editor.value
  if (!ed || !guard.isCurrent()) return

  const imageUrl = previewImageUrl.value
    ?? await getResourceUrl(imagePath, currentProject.value?.path || '')
  if (!guard.isCurrent() || editor.value !== ed) return

  previewImageUrl.value = imageUrl
  await ed.setBackgroundImage(imageUrl)
  if (!guard.isCurrent() || editor.value !== ed) return

  loadingState.value = 'ready'
  loadingMessage.value = ''
  void nextTick(() => {
    editor.value?.fitToWorld(10)
    requestAnimationFrame(() => editor.value?.fitToWorld(10))
  })
}

async function onOpenNativeLayoutViewer(): Promise<void> {
  if (nativeLayoutViewerBusy.value) return
  const projectPath = currentProject.value?.path
  const viewJsonPackageRoot = currentViewJsonPackageRoot.value
  if (!projectPath || !viewJsonPackageRoot || !isDesktopRuntime()) return

  nativeLayoutViewerBusy.value = true
  loadingState.value = 'loading'
  loadingMessage.value = NATIVE_LAYOUT_VIEWER_LOADING_MESSAGE
  try {
    const desktopApi = getDesktopApi()
    await desktopApi.layoutViewer.open({
      projectPath,
      viewJsonPackageRoot,
    })
  } catch (err) {
    console.error('Failed to open native layout viewer:', err)
    loadingState.value = 'error'
    loadingMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    nativeLayoutViewerBusy.value = false
    if (
      loadingState.value === 'loading'
      && loadingMessage.value === NATIVE_LAYOUT_VIEWER_LOADING_MESSAGE
    ) {
      resetLoadingState()
    }
  }
}

const handleStageChange = async (stage: string) => {
  if (!editor.value || !stage) return
  const guard = createDrawingAsyncGuard(stage)
  resetLoadingState()

  const stepEnum = getStepEnumFromPath(stage)
  if (!stepEnum) {
    editor.value.clearBackground()
    clearCurrentPreview()
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
      const imagePath = typeof info.image === 'string' && info.image.length > 0 ? info.image : null
      const viewJsonPackageRoot = pickViewJsonPackageRoot(info)

      currentViewJsonPackageRoot.value = viewJsonPackageRoot
      previewImageUrl.value = null

      if (!imagePath) {
        editor.value?.clearBackground()
        resetLoadingState()
        return
      }

      loadingState.value = 'loading'
      loadingMessage.value = 'Loading preview image...'
      await loadStepImagePreview(imagePath, guard)
      return
    }

    editor.value?.clearBackground()
    clearCurrentPreview()
  } catch (error) {
    console.error('Failed to load stage results:', error)
    if (!guard.isCurrent()) return
    editor.value?.clearBackground()
    clearCurrentPreview()
    resetLoadingState()
  }
}

const onEditorReady = (editorInstance: Editor) => {
  editor.value = editorInstance
  const pathParts = route.path.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
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
  { immediate: true },
)

watch(() => route.path, (newPath) => {
  const pathParts = newPath.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
})

watch(
  () => [
    resourceVersions.value.step,
    resourceVersions.value.all,
  ],
  () => {
    const pathParts = route.path.split('/')
    const stage = pathParts[pathParts.length - 1] || 'home'
    handleStageChange(stage)
  },
)

onUnmounted(() => {
  detachCanvasPointerListeners?.()
})
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <DrawingToolbar
      :editor="editor"
      :show-native-layout-viewer="showNativeLayoutViewer"
      :native-layout-viewer-busy="nativeLayoutViewerBusy"
      @openNativeLayoutViewer="onOpenNativeLayoutViewer"
    />

    <div class="relative flex-1 overflow-hidden">
      <EditorContainer @ready="onEditorReady" />

      <div
        v-if="loadingState === 'loading'"
        :data-testid="isPreparingNativeLayoutViewer ? 'native-layout-viewer-loading' : undefined"
        class="absolute inset-0 z-10 flex items-center justify-center bg-black/40 transition-opacity duration-200"
      >
        <div
          class="flex min-w-64 flex-col items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-5 py-4 text-center text-sm text-white/80 shadow-2xl backdrop-blur-sm"
          :class="{ 'gap-3': isPreparingNativeLayoutViewer }"
        >
          <div
            class="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white/80"
            :class="{ 'h-8 w-8': isPreparingNativeLayoutViewer }"
          ></div>
          <span class="font-medium">{{ loadingMessage || 'Loading...' }}</span>
          <span
            v-if="isPreparingNativeLayoutViewer"
            data-testid="native-layout-viewer-loading"
            class="max-w-72 text-xs leading-5 text-white/55"
          >
            Preparing Native Layout Viewer package before opening the window.
          </span>
        </div>
      </div>

      <div
        v-if="loadingState === 'error'"
        class="absolute bottom-4 left-4 z-10 rounded bg-red-900/80 px-3 py-2 text-xs text-red-200"
      >
        Load error: {{ loadingMessage }}
      </div>

      <div class="absolute right-2 top-2 z-20 flex flex-col items-end gap-1 pointer-events-none">
        <div
          v-if="cursorEda"
          class="rounded border border-(--border-color) bg-(--bg-primary)/90 px-2 py-1 font-mono text-[11px] text-(--text-primary) tabular-nums shadow-sm"
        >
          <span class="text-(--text-secondary)">X</span> {{ formatCursorCoord(cursorEda.x) }}
          <span class="ml-2 text-(--text-secondary)">Y</span> {{ formatCursorCoord(cursorEda.y) }}
        </div>
      </div>
    </div>
  </div>
</template>
