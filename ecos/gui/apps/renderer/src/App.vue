<template>
  <div class="app-wrapper">
    <!-- 主应用容器 -->
    <div class="app-container">
      <!-- 全局顶部菜单栏 -->
      <TopBar :project-name="isWelcome ? null : currentProject?.name" @menu-action="handleMenuAction" />
      <!-- 页面内容 -->
      <div
        class="app-main"
        :style="terminalExpanded ? { '--terminal-panel-height': terminalPanelHeight } : undefined"
      >
        <div class="app-content" :class="{ 'app-content--terminal-open': terminalExpanded }">
          <router-view />
        </div>
        <ECOSTerminal :expanded="terminalExpanded" @collapse="terminalExpanded = false" />
      </div>
      <StatusBar
        :terminal-expanded="terminalExpanded"
        @toggle-terminal="terminalExpanded = !terminalExpanded"
      />
    </div>

    <!-- 全局 Toast 通知 -->
    <Toast position="top-right" class="app-toast" />

    <!-- 全局新建工程向导 -->
    <NewProjectWizard v-if="showNewProjectWizard" @close="showNewProjectWizard = false" @create="handleWizardCreate" />

    <AboutDialog v-model="showAboutDialog" />

    <!-- Full-screen loading while the workspace is being prepared (open/new project, session restore) -->
    <Teleport to="body">
      <Transition name="runtime-backend-overlay">
        <div
          v-if="runtimeBackendConnecting"
          class="runtime-backend-overlay"
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <div class="runtime-backend-panel">
            <div class="runtime-backend-spinner" aria-hidden="true" />
            <p class="runtime-backend-title">Preparing your workspace</p>
            <p class="runtime-backend-sub">First load or restoring your project may take a moment</p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import type { DesktopApi } from '@ecos-studio/shared'
import { useRouter, useRoute } from 'vue-router'
import { useThemeStore } from '@/stores/themeStore'
import { useAppMenuActions } from '@/composables/useAppMenuActions'
import { useAppWindowClose } from '@/composables/useAppWindowClose'
import { useWorkspace } from '@/composables/useWorkspace'
import { usePdkManager } from '@/composables/usePdkManager'
import { useVersion } from '@/composables/useVersion'
import { getOptionalDesktopApi, hasDesktopApi, waitForDesktopApi } from '@/platform/desktop'

import TopBar from '@/components/TopBar.vue'
import StatusBar from '@/components/StatusBar.vue'
import ECOSTerminal from '@/components/ECOSTerminal.vue'
import AboutDialog from '@/components/AboutDialog.vue'
import Toast from 'primevue/toast'
import NewProjectWizard from '@/components/NewProjectWizard.vue'
import type { WorkspaceConfig } from '@/types'
import { setWindowResizing } from '@/composables/useWindowResizeState'

const router = useRouter()
const themeStore = useThemeStore()
const route = useRoute()
const isWelcome = computed(() => route.path === '/')
const { loadRecentProjects, currentProject, openProject, newProject, closeProject, runtimeBackendConnecting } =
  useWorkspace()
const { loadPdks } = usePdkManager()
const { loadVersions } = useVersion()
const { showToast } = useWorkspace()
const desktopApi = ref<DesktopApi | null>(getOptionalDesktopApi())
const documentationUrl =
  'https://github.com/openecos-projects/ecos-studio/blob/main/ecos/docs/user-guide.md'
// ---- 新建工程向导 ----
const showNewProjectWizard = ref(false)
const showAboutDialog = ref(false)
const terminalExpanded = ref(false)
const terminalPanelHeight = 'min(300px, 42vh)'

const handleWizardCreate = async (config: WorkspaceConfig) => {
  showNewProjectWizard.value = false
  const success = await newProject(config)
  if (success) router.push('/workspace')
}

const openDocumentation = async () => {
  try {
    if (desktopApi.value ?? hasDesktopApi()) {
      const api = desktopApi.value ?? await waitForDesktopApi()
      desktopApi.value = api
      await api.system.openExternal(documentationUrl)
    } else {
      window.open(documentationUrl, '_blank', 'noopener,noreferrer')
    }
  } catch (error) {
    console.error('Failed to open documentation:', error)
    showToast({
      severity: 'error',
      summary: 'Error',
      detail: `Failed to open documentation because of ${error instanceof Error ? error.message : String(error)}`,
      life: 3000
    })
  }
}

const { handleMenuAction } = useAppMenuActions({
  navigateToWorkspace: () => {
    router.push('/workspace')
  },
  openDocumentation,
  openProject,
  showAboutDialog: () => {
    showAboutDialog.value = true
  },
  showNewProjectWizard: () => {
    showNewProjectWizard.value = true
  },
})
useAppWindowClose(closeProject)

let isResizing = false

// 统一管理 `.window-resizing` class：
// - 桌面窗口的 resize 事件任一来源都会打上这个 class
// - 超过 RESIZE_IDLE_MS 没有新尺寸事件即视为结束
const RESIZE_IDLE_MS = 180
let resizeIdleTimer: ReturnType<typeof setTimeout> | undefined
let unlistenWindowResized: (() => void) | undefined
let unlistenWindowMaximizedChanged: (() => void) | undefined

/**
 * 快路径检测"这次 resize 是不是奔着最大化去的"。
 *
 * `.window-maximized` 的权威来源是 `isMaximized()`，但它是一次 IPC 往返、
 * 往往要几 ~ 几十 ms 才 resolve。而最大化在屏幕上是瞬时发生的，这段 IPC
 * 窗口期里 WebKitGTK 的 transparent 已失效（最大化关闭透明），app-container
 * 的边框又还没被 `.window-maximized` 消掉，边缘位置就可能露出 webview
 * 的白画布，即用户看到的"最大化白闪"。
 *
 * 对策：在 onResized 事件回调里同步读 `window.innerWidth/innerHeight` 与
 * `screen.availWidth/availHeight` 比较，视口接近铺满屏幕就直接乐观地挂上
 * `.window-maximized`；随后 `isMaximized()` 的权威结果再由 `syncMaximizedClass`
 * 做修正。边缘拖拽缩放时启发式判为 false，`.window-maximized` 不挂，窗口
 * 常态视觉完整保留。
 *
 * `- 2` 的余量是为了兼容某些 WM（KDE / Hyprland 等）把窗口最大化到不含面板
 * 的工作区时，视口比 availWidth 少 1 ~ 2 px 的 off-by-one。
 */
function detectLikelyMaximized(): boolean {
  if (typeof window === 'undefined' || !window.screen) return false
  const { availWidth, availHeight } = window.screen
  if (!availWidth || !availHeight) return false
  return window.innerWidth >= availWidth - 2 && window.innerHeight >= availHeight - 2
}

const markResizing = () => {
  isResizing = true
  document.body.classList.add('window-resizing')
  // 广播全局状态，组件（如 HomeView 的 ECharts）可据此跳过昂贵重绘
  setWindowResizing(true)
  // 同步快路径：视口已经铺满屏幕就立刻挂 `.window-maximized`，
  // 不等 `isMaximized()` IPC 回来，消除最大化瞬间的边框白闪。
  if (detectLikelyMaximized()) {
    document.body.classList.add('window-maximized')
  }
  // 随后用权威的 `isMaximized()` 修正快路径可能的误判（例如窗口刚好
  // 被用户手动拖到接近屏幕尺寸但并没真的 maximize）。
  void syncMaximizedClass()
  if (resizeIdleTimer) clearTimeout(resizeIdleTimer)
  resizeIdleTimer = setTimeout(() => {
    resizeIdleTimer = undefined
    isResizing = false
    document.body.classList.remove('window-resizing')
    setWindowResizing(false)
    // 停歇时再同步一次，兜底系统贴边 / 快捷键等中间态没覆盖的情况
    void syncMaximizedClass()
  }, RESIZE_IDLE_MS)
}

/**
 * 同步窗口最大化状态到 body.window-maximized。
 *
 * 目的：Linux (WebKitGTK) 下「透明 + 无装饰 + 最大化」组合会让 webview
 * 露出白色画布，因此最大化时需要把根层背景改成主题色、去掉边框，
 * 见 styles/index.css 与本文件 scoped 样式中的 `.window-maximized` 规则。
 */
async function syncMaximizedClass() {
  if (!desktopApi.value) {
    return
  }

  try {
    const maxed = await desktopApi.value.window.isMaximized()
    document.body.classList.toggle('window-maximized', maxed)
  } catch {
    /* ignore: window API unavailable (e.g. SSR / test) */
  }
}

// 阻止拖拽调整窗口大小时的文本选择
const handleSelectStart = (e: Event) => {
  if (isResizing) {
    e.preventDefault()
    return false
  }
}

onMounted(async () => {
  if (!desktopApi.value) {
    try {
      desktopApi.value = await waitForDesktopApi({ timeoutMs: 5000 })
    } catch (error) {
      console.warn('[App] Desktop bridge not available on initial mount:', error)
    }
  }
  console.info('[App] Desktop bridge available:', Boolean(desktopApi.value))

  themeStore.initTheme()
  // 在应用启动时加载最近项目和已导入的 PDK
  await Promise.all([loadRecentProjects(), loadPdks()])
  loadVersions()

  document.addEventListener('selectstart', handleSelectStart)

  // 启动时先同步一次最大化状态（从持久化会话恢复的场景）
  void syncMaximizedClass()

  if (!desktopApi.value) {
    return
  }

  // 由桌面桥接的 resize 事件统一驱动降级状态，覆盖所有缩放来源。
  unlistenWindowResized = desktopApi.value.window.onResized(() => {
    markResizing()
  })
  unlistenWindowMaximizedChanged = desktopApi.value.window.onMaximizedChanged((isMaximized) => {
    document.body.classList.toggle('window-maximized', isMaximized)
  })
})

onUnmounted(() => {
  document.removeEventListener('selectstart', handleSelectStart)
  if (resizeIdleTimer) {
    clearTimeout(resizeIdleTimer)
    resizeIdleTimer = undefined
  }
  unlistenWindowResized?.()
  unlistenWindowMaximizedChanged?.()
  document.body.classList.remove('window-resizing')
  document.body.classList.remove('window-maximized')
  setWindowResizing(false)
})
</script>

<style>
/* Teleport 到 body，需非 scoped 才能作用在传送后的节点上 */
.runtime-backend-overlay {
  position: fixed;
  inset: 0;
  z-index: 20050;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
}

.runtime-backend-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 40px;
  border-radius: 12px;
  background: var(--bg-primary);
  border: 1px solid rgba(128, 128, 128, 0.28);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  min-width: 240px;
}

.runtime-backend-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border-color, rgba(128, 128, 128, 0.35));
  border-top-color: var(--accent-color, #4a9eff);
  border-radius: 50%;
  animation: runtime-backend-spin 0.75s linear infinite;
}

.runtime-backend-title {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #e8e8e8);
}

.runtime-backend-sub {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  text-align: center;
  line-height: 1.45;
}

@keyframes runtime-backend-spin {
  to {
    transform: rotate(360deg);
  }
}

.runtime-backend-overlay-enter-active,
.runtime-backend-overlay-leave-active {
  transition: opacity 0.22s ease;
}

.runtime-backend-overlay-enter-active .runtime-backend-panel,
.runtime-backend-overlay-leave-active .runtime-backend-panel {
  transition: transform 0.22s ease, opacity 0.22s ease;
}

.runtime-backend-overlay-enter-from,
.runtime-backend-overlay-leave-to {
  opacity: 0;
}

.runtime-backend-overlay-enter-from .runtime-backend-panel,
.runtime-backend-overlay-leave-to .runtime-backend-panel {
  transform: scale(0.96);
  opacity: 0.85;
}

/*
 * 窗口 resize 期间的性能降级：
 * 无装饰 + 透明窗口下，每一帧的布局/合成代价都很高，叠加 blur、阴影、
 * 过渡/动画会让拖边界的手感明显卡顿。resize 停歇后（App.vue 里通过
 * onResized + 去抖移除 class）自动恢复，所以视觉上几乎感觉不到差别。
 */
.window-resizing,
.window-resizing * {
  transition: none !important;
  animation: none !important;
  filter: none !important;
  -webkit-filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  scroll-behavior: auto !important;
}

/*
 * 额外降级：隐藏带 background-image 渐变绘制的 HUD 角标 / 栅格线等装饰。
 * 这些元素每帧都需要 repaint，单独一个就抵掉半帧预算，resize 期间不渲染
 * 它们能显著提升拖拽流畅度。
 */
.window-resizing .bg-grid,
.window-resizing .layout-content {
  background-image: none !important;
}

.window-resizing .section-card::after {
  display: none !important;
}

/* resize 期间图片用最快速路径重采样，避免触发高质量重采样造成的抖动 */
.window-resizing img {
  image-rendering: auto;
}

.window-resizing {
  cursor: default;
}

/*
 * PrimeVue Toast is rendered by this root component and its internal markup is
 * not scoped. Keep long backend errors, paths, and command output inside the
 * notification bubble instead of letting them spill past the rounded panel.
 */
.app-toast.p-toast {
  width: min(420px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
}

.app-toast .p-toast-message {
  max-width: 100%;
  overflow: hidden;
}

.app-toast .p-toast-message-content {
  align-items: flex-start;
  min-width: 0;
}

.app-toast .p-toast-message-icon,
.app-toast .p-toast-close-button {
  flex: 0 0 auto;
}

.app-toast .p-toast-message-text {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 100%;
}

.app-toast .p-toast-summary,
.app-toast .p-toast-detail {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.app-toast .p-toast-detail {
  line-height: 1.45;
}
</style>

<style scoped>
.app-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
}

.app-container {
  width: 100%;
  height: 100%;
  max-width: 100vw;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 0;
  background: var(--bg-primary);
  /* 边框 - 微弱的亮色边框 */
  border: 1px solid rgba(128, 128, 128, 0.3);
}

/*
 * 最大化时取消边框：
 * 最大化后窗口占满屏幕，边框外露出的可能是 webview 白画布（也就是截图里
 * 那片白屏）。去掉边框后 .app-container 能贴住窗口四边，彻底没处可露。
 * body 不会被 scoped 加 data-v 属性（它是 ancestor），`.app-container`
 * 是本组件自身元素，scoped 转换后选择器仍能正确命中。
 */
body.window-maximized .app-container {
  border-radius: 0;
  border: none;
}

.app-main {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: var(--bg-primary);
}

.app-content {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: var(--bg-primary);
}

.app-content--terminal-open {
  padding-bottom: var(--terminal-panel-height);
}

/* 调整大小的边缘区域 */
.resize-edge,
.resize-corner {
  position: absolute;
  z-index: 9999;
}

/*
 * 四角 resize 区域需要盖过顶栏按钮，否则用户把鼠标甩到窗口角落时总是
 * 命中按钮或边缘条、永远碰不到对角 resize —— 这正是"斜拉只能横/纵向"
 * 那个 bug 的根因。放到更高的 z-index，并且尺寸足够大（16px）让命中
 * 率更高；但右上角要避开关闭按钮的点击主体，所以刻意只保留与顶栏
 * `.window-btn-close` 的 border-radius（10px）相当的小三角，不会抢走
 * 按钮的主要点击区域。
 */

/* 上边缘（左右留出顶栏按钮/菜单区域，避免与自定义标题栏重叠导致点击被当成 resize） */
.resize-top {
  top: 0;
  left: 220px;
  right: 220px;
  height: 6px;
  cursor: ns-resize;
}

/* 下边缘 */
.resize-bottom {
  bottom: 0;
  left: 20px;
  right: 20px;
  height: 6px;
  cursor: ns-resize;
}

/* 左边缘：从四角 resize 区之后开始，避免和对角 resize 打架 */
.resize-left {
  left: 0;
  top: 16px;
  bottom: 16px;
  width: 6px;
  cursor: ew-resize;
}

/* 右边缘：同样让开四角 resize 区 */
.resize-right {
  right: 0;
  top: 16px;
  bottom: 16px;
  width: 6px;
  cursor: ew-resize;
}

/*
 * 左上角：位于窗口真正的左上角。10×10 刚好落在顶栏左侧图标 padding(16px)
 * 之内，不会挡住 app-icon / 菜单按钮点击。
 */
.resize-top-left {
  top: 0;
  left: 0;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
  z-index: 10001;
}

/*
 * 右上角：10×10 刚好落在 `.window-btn-close` border-radius(10px) 的视觉
 * 圆角之内，那块区域本来视觉上就是透明的，改成 resize 命中区既符合
 * 用户心理预期，又不影响按钮主要点击区域（46×40）。z-index 高于其他
 * 边缘条，保证角落优先触发对角 resize。
 */
.resize-top-right {
  top: 0;
  right: 0;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
  z-index: 10001;
}

/* 左下角 */
.resize-bottom-left {
  bottom: 0;
  left: 0;
  width: 16px;
  height: 16px;
  cursor: nesw-resize;
  z-index: 10001;
}

/* 右下角 */
.resize-bottom-right {
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 10001;
}

/*
 * 最大化时整体禁用 resize 命中区：
 * 1. 最大化状态下触发 resizeDragging 会被 WM 立刻取消最大化，体验很糟；
 * 2. 四角 resize 区（尤其是 `.resize-top-right` 的 10×10）在最大化后会
 *    占着屏幕最右上角那块像素，和 `.window-btn-close` 贴边后的点击区
 *    重叠，导致"按键部分可按动部分不全"—— 这正是 WSL 下反馈的问题。
 * pointer-events:none 让事件直接穿透到下方的按钮，鼠标能准确命中 Close。
 */
body.window-maximized .resize-edge,
body.window-maximized .resize-corner {
  pointer-events: none;
}
</style>
