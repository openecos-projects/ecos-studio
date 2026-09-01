<template>
  <div class="topbar">
    <!-- 左侧：应用图标和菜单栏 -->
    <div class="topbar-left" @mousedown.stop>
      <!-- 应用图标 -->
      <div class="app-icon">
        <i class="ri-cpu-line"></i>
      </div>

      <!-- 菜单项（带下拉菜单） -->
      <div class="menu-items" ref="menuBarRef">
        <div v-for="menu in menus" :key="menu.label" class="menu-wrapper">
          <button
            @click="toggleMenu(menu.action)"
            @mouseenter="handleMenuHover(menu.action)"
            class="menu-btn"
            :class="{ 'menu-btn-active': activeMenu === menu.action }"
          >
            {{ menu.label }}
          </button>
          <!-- 下拉菜单 -->
          <Transition name="dropdown">
            <div v-if="activeMenu === menu.action && menu.children" class="dropdown-menu">
              <template v-for="(item, idx) in menu.children" :key="idx">
                <div v-if="item.separator" class="dropdown-separator" />
                <button
                  v-else
                  @click="handleItemClick(item.event)"
                  class="dropdown-item"
                  :disabled="item.disabled"
                >
                  <i v-if="item.icon" :class="item.icon" class="item-icon" />
                  <span class="item-label">{{ item.label }}</span>
                  <span v-if="item.shortcut" class="item-shortcut">{{
                    item.shortcut
                  }}</span>
                </button>
              </template>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <div class="topbar-drag-spacer" data-window-drag-region aria-hidden="true"></div>

    <div class="topbar-center">
      <span class="project-name">{{ props.projectName }}</span>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="topbar-right" @mousedown.stop>
      <div v-if="isWorkspaceRoute" ref="quickMenuRef" class="workspace-quick-menu">
        <button
          type="button"
          class="window-btn workspace-quick-menu-btn"
          :class="{ active: quickMenuOpen }"
          title="Workspace shortcuts"
          aria-label="Workspace shortcuts"
          :aria-expanded="quickMenuOpen"
          @click.stop="toggleQuickMenu"
        >
          <i class="ri-more-2-line text-base"></i>
        </button>
      </div>
      <span
        v-if="isWorkspaceRoute"
        class="topbar-right-separator"
        aria-hidden="true"
      ></span>
      <button
        v-if="!isWorkspaceRoute"
        type="button"
        class="window-btn"
        :class="{ active: chatButtonActive }"
        title="ECOS Agent"
        aria-label="ECOS Agent"
        :aria-pressed="chatButtonActive"
        @click="handleAgentChatClick"
      >
        <i class="ri-sparkling-2-line text-base" aria-hidden="true"></i>
      </button>
      <NotificationCenter />
      <button
        @click="toggleTheme"
        class="window-btn theme-btn"
        :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'"
      >
        <i :class="isDark ? 'ri-sun-line' : 'ri-moon-line'" class="text-base"></i>
      </button>
      <template v-if="desktopApi">
        <!-- 最小化 -->
        <button @click="handleMinimize" class="window-btn" aria-label="Minimize window">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <!-- 最大化 / 还原 -->
        <button
          @click="handleMaximize"
          class="window-btn"
          :aria-label="isMaximized ? 'Restore window' : 'Maximize window'"
        >
          <!-- 最大化：单框 -->
          <svg
            v-if="!isMaximized"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <rect
              x="2.5"
              y="2.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
          </svg>
          <!-- 还原：重叠双框 -->
          <svg v-else width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect
              x="4.5"
              y="4.5"
              width="7.5"
              height="7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
            <rect
              x="2.5"
              y="2.5"
              width="7.5"
              height="7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1"
            />
          </svg>
        </button>
        <!-- 关闭 -->
        <button
          @click="handleClose"
          class="window-btn window-btn-close"
          aria-label="Close window"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3 3L9 9M9 3L3 9"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </template>
    </div>
  </div>
  <Teleport to="body">
    <Transition name="dropdown">
      <div
        v-if="quickMenuOpen && isWorkspaceRoute"
        class="quick-dropdown-menu"
        :style="quickMenuStyle"
        @click.stop
      >
        <button
          type="button"
          class="quick-dropdown-item"
          title="Back to Home"
          aria-label="Back to Home"
          @click="handleGoHome"
        >
          <i class="ri-home-4-line item-icon"></i>
          <span class="item-label">Back to Home</span>
        </button>
        <button
          type="button"
          class="quick-dropdown-item"
          title="Return to Project Management"
          @click="goToProjectManagement"
        >
          <i class="ri-folder-chart-line item-icon"></i>
          <span class="item-label">Back to Project Management</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { AppMenuAction } from '@ecos-studio/shared'
import { appMenuActionIds } from '@ecos-studio/shared'
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useThemeStore } from '@/stores/themeStore'
import { useAgentShellStore } from '@/stores/agentShellStore'
import { useRoute, useRouter } from 'vue-router'
import type { DesktopApi } from '@ecos-studio/shared'
import { getOptionalDesktopApi, waitForDesktopApi } from '@/platform/desktop'
import NotificationCenter from '@/components/NotificationCenter.vue'
// ---- 类型定义 ----
type TopBarMenuAction = AppMenuAction | 'step-config'

interface DropdownItem {
  label?: string
  icon?: string
  shortcut?: string
  event?: TopBarMenuAction
  separator?: boolean
  disabled?: boolean
}

interface Menu {
  label: string
  action: string
  children?: DropdownItem[]
}

const route = useRoute()
const router = useRouter()
const isWorkspaceRoute = computed(() => route.path.startsWith('/workspace'))
const workspaceProjectRoot = computed(() => queryString(route.query.projectRoot))
const workspaceProjectName = computed(() => queryString(route.query.projectName))
// ---- Props & Emits ----
const props = defineProps<{
  projectName?: string | null
  hasWorkspace?: boolean
}>()

const emit = defineEmits<{
  (e: 'menu-action', action: AppMenuAction): void
  (e: 'step-config'): void
}>()

const workspaceFocusId = computed(
  () =>
    queryString(route.query.workspaceId) || workspaceIdFromProjectName(props.projectName),
)

const themeStore = useThemeStore()
const agentShell = useAgentShellStore()
const { homeAgentOpen } = storeToRefs(agentShell)
const isDark = computed(() => themeStore.themeName === 'dark')
const chatButtonActive = computed(() => homeAgentOpen.value)
const desktopApi = ref<DesktopApi | null>(getOptionalDesktopApi())
const canOpenStepConfig = computed(
  () => isWorkspaceRoute.value && Boolean(props.hasWorkspace),
)
const toggleTheme = () => {
  themeStore.toggleTheme()
}

function handleAgentChatClick(): void {
  activeMenu.value = null
  quickMenuOpen.value = false
  agentShell.toggleHomeAgent()
}

const handleGoHome = () => {
  activeMenu.value = null
  quickMenuOpen.value = false
  router.push({ name: 'ECOS' })
}

const editMenu = computed<Menu>(() => ({
  label: 'Edit',
  action: 'edit',
  children: [
    {
      label: 'Config',
      icon: 'ri-settings-3-line',
      event: 'step-config',
      disabled: !canOpenStepConfig.value,
    },
  ],
}))

// ---- 菜单配置 ----
const menus = computed<Menu[]>(() => [
  {
    label: 'File',
    action: 'file',
    children: [
      {
        label: 'New Window',
        icon: 'ri-window-line',
        shortcut: '⇧⌘N',
        event: appMenuActionIds.newWindow,
      },
      {
        label: 'New Workspace',
        icon: 'ri-add-line',
        shortcut: '⌘N',
        event: appMenuActionIds.newProject,
      },
      {
        label: 'Open Workspace',
        icon: 'ri-folder-open-line',
        shortcut: '⌘O',
        event: appMenuActionIds.openProject,
      },
      {
        label: 'Update Workspace',
        icon: 'ri-settings-3-line',
        event: appMenuActionIds.reconfigureWorkspace,
        disabled: !props.hasWorkspace,
      },
      ...(isWorkspaceRoute.value
        ? [
            {
              label: 'Export Signoff Package',
              icon: 'ri-archive-line',
              event: appMenuActionIds.exportSignoffPackage,
            },
            {
              label: 'Export Design Summary',
              icon: 'ri-file-chart-line',
              event: appMenuActionIds.exportDesignSummary,
            },
          ]
        : []),
    ],
  },
  ...(isWorkspaceRoute.value ? [editMenu.value] : []),
  {
    label: 'View',
    action: 'view',
    children: [
      {
        label: 'Zoom In',
        icon: 'ri-zoom-in-line',
        shortcut: '⌘+',
        event: appMenuActionIds.zoomIn,
      },
      {
        label: 'Zoom Out',
        icon: 'ri-zoom-out-line',
        shortcut: '⌘−',
        event: appMenuActionIds.zoomOut,
      },
      {
        label: 'Reset Zoom',
        icon: 'ri-refresh-line',
        shortcut: '⌘0',
        event: appMenuActionIds.zoomReset,
      },
    ],
  },
  {
    label: 'Help',
    action: 'help',
    children: [
      {
        label: 'Documentation',
        icon: 'ri-book-open-line',
        event: appMenuActionIds.documentation,
      },
      { separator: true },
      { label: 'About', icon: 'ri-information-line', event: appMenuActionIds.about },
    ],
  },
])

// ---- 下拉菜单状态 ----
const activeMenu = ref<string | null>(null)
const menuBarRef = ref<HTMLElement | null>(null)
const quickMenuOpen = ref(false)
const quickMenuRef = ref<HTMLElement | null>(null)
const quickMenuStyle = ref<Record<string, string>>({})

function queryString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function workspaceIdFromProjectName(projectName?: string | null): string {
  if (!projectName) return ''
  return projectName.split(/[/\\]/).filter(Boolean).pop() ?? ''
}

/** 切换菜单展开/收起 */
const toggleMenu = (action: string) => {
  quickMenuOpen.value = false
  activeMenu.value = activeMenu.value === action ? null : action
}

/** 鼠标悬浮切换（仅当已有菜单打开时） */
const handleMenuHover = (action: string) => {
  if (activeMenu.value && activeMenu.value !== action) {
    activeMenu.value = action
  }
}

/** 下拉项点击 */
const handleItemClick = (event?: TopBarMenuAction) => {
  activeMenu.value = null
  if (event === 'step-config') return emit('step-config')
  if (event) emit('menu-action', event)
}

function updateQuickMenuPosition() {
  const rect = quickMenuRef.value?.getBoundingClientRect()
  if (!rect) return

  quickMenuStyle.value = {
    top: `${rect.bottom + 4}px`,
    right: `${Math.max(8, window.innerWidth - rect.right)}px`,
  }
}

const toggleQuickMenu = async () => {
  activeMenu.value = null
  quickMenuOpen.value = !quickMenuOpen.value
  if (quickMenuOpen.value) {
    await nextTick()
    updateQuickMenuPosition()
  }
}

const goToProjectManagement = () => {
  quickMenuOpen.value = false
  const query: Record<string, string> = {}
  if (workspaceProjectRoot.value) {
    query.projectRoot = workspaceProjectRoot.value
    if (workspaceProjectName.value) query.projectName = workspaceProjectName.value
  }
  if (workspaceFocusId.value) query.workspaceId = workspaceFocusId.value
  router.push({
    path: '/projects',
    query,
  })
}

/** 点击菜单栏外部关闭 */
const handleClickOutside = (e: MouseEvent) => {
  if (menuBarRef.value && !menuBarRef.value.contains(e.target as Node)) {
    activeMenu.value = null
  }
  if (quickMenuRef.value && !quickMenuRef.value.contains(e.target as Node)) {
    quickMenuOpen.value = false
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  )
}

/** Escape 关闭菜单；File 快捷键与菜单文案一致（⇧⌘N / ⌘N / ⌘O） */
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    activeMenu.value = null
    quickMenuOpen.value = false
    return
  }

  if (e.repeat || isEditableKeyboardTarget(e.target)) return

  const mod = e.metaKey || e.ctrlKey
  if (!mod) return

  const key = e.key.toLowerCase()
  if (e.shiftKey && key === 'n') {
    e.preventDefault()
    activeMenu.value = null
    emit('menu-action', appMenuActionIds.newWindow)
    return
  }
  if (!e.shiftKey && key === 'n') {
    e.preventDefault()
    activeMenu.value = null
    emit('menu-action', appMenuActionIds.newProject)
    return
  }
  if (!e.shiftKey && key === 'o') {
    e.preventDefault()
    activeMenu.value = null
    emit('menu-action', appMenuActionIds.openProject)
  }
}

const handleQuickMenuViewportChange = () => {
  if (quickMenuOpen.value) updateQuickMenuPosition()
}

const isMaximized = ref(false)
let unlistenMaximizedChanged: (() => void) | undefined

async function syncMaximizedState() {
  if (!desktopApi.value) {
    return
  }

  try {
    isMaximized.value = await desktopApi.value.window.isMaximized()
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', handleQuickMenuViewportChange)
  window.addEventListener('scroll', handleQuickMenuViewportChange, true)

  if (!desktopApi.value) {
    try {
      desktopApi.value = await waitForDesktopApi({ timeoutMs: 5000 })
    } catch (error) {
      console.warn('[TopBar] Desktop bridge did not become available in time:', error)
      return
    }
  }

  void syncMaximizedState()
  unlistenMaximizedChanged = desktopApi.value.window.onMaximizedChanged(
    (nextIsMaximized) => {
      isMaximized.value = nextIsMaximized
    },
  )
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', handleQuickMenuViewportChange)
  window.removeEventListener('scroll', handleQuickMenuViewportChange, true)
  unlistenMaximizedChanged?.()
})

// ---- 窗口控制 ----
const handleMinimize = async () => {
  const api = desktopApi.value ?? (await waitForDesktopApi())
  await api.window.minimize()
}

const handleMaximize = async () => {
  const api = desktopApi.value ?? (await waitForDesktopApi())
  await api.window.toggleMaximize()
}

const handleClose = async () => {
  const api = desktopApi.value ?? (await waitForDesktopApi())
  await api.window.close()
}
</script>

<style scoped>
.topbar {
  height: 40px;
  width: 100%;
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  user-select: none;
  -webkit-user-select: none;
  background: var(--topbar-bg);
  border-bottom: 1px solid var(--border-color);
  position: relative;
  z-index: 100;
  cursor: default;
}

/* 左侧区域 */
.topbar-left {
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: 16px;
  gap: 8px;
  z-index: 30;
  position: relative;
  -webkit-app-region: no-drag;
}

.app-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: var(--accent-color);
  font-size: 18px;
}

.app-icon-img {
  width: 20px;
  height: 20px;
  object-fit: contain;
  display: block;
  -webkit-user-drag: none;
  user-select: none;
  pointer-events: none;
}

.menu-items {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 2px;
}

/* 菜单项容器（含下拉） */
.menu-wrapper {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
}

.menu-btn {
  height: 100%;
  padding: 0 10px;
  font-size: 13px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.15s,
    background-color 0.15s;
  border-radius: 4px;
}

.menu-btn:hover,
.menu-btn-active {
  color: var(--text-primary);
  background: var(--bg-secondary);
}

/* ===== 下拉菜单 ===== */
.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 220px;
  padding: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.35),
    0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 1000;
}

.dropdown-separator {
  height: 1px;
  margin: 4px 8px;
  background: var(--border-color);
}

.dropdown-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  gap: 10px;
  transition: background-color 0.12s;
  text-align: left;
}

.dropdown-item:hover {
  background: var(--accent-color);
  color: #fff;
}

.dropdown-item:hover .item-icon {
  color: #fff;
}

.dropdown-item:hover .item-shortcut {
  color: rgba(255, 255, 255, 0.7);
}

.dropdown-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.dropdown-item:disabled:hover {
  background: transparent;
  color: var(--text-primary);
}

.item-icon {
  font-size: 15px;
  color: var(--text-secondary);
  width: 18px;
  text-align: center;
  flex-shrink: 0;
  transition: color 0.12s;
}

.item-label {
  flex: 1;
}

.item-shortcut {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.6;
  flex-shrink: 0;
  transition: color 0.12s;
}

/* 下拉菜单过渡动画 */
.dropdown-enter-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.dropdown-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}

.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

/*
 * 只让中间空白区域承担窗口拖拽。
 * 如果把 drag region 挂在覆盖全宽的标题层上，桌面端会优先命中拖拽层，
 * 左侧菜单即使视觉上在上面，也可能被判定为“不可点击”。
 */
.topbar-drag-spacer {
  flex: 1;
  min-width: 0;
  height: 100%;
}

/* 中间标题层 - 始终居中，但不接管点击 */
.topbar-center {
  position: absolute;
  inset: 0;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 0;
}

.project-name {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* 右侧窗口控制 */
.topbar-right {
  display: flex;
  align-items: center;
  height: 100%;
  z-index: 1;
  position: relative;
  -webkit-app-region: no-drag;
}

.workspace-quick-menu {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
}

.workspace-quick-menu-btn {
  width: 40px;
}

.workspace-quick-menu-btn.active {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.topbar-right-separator {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: var(--border-color);
}

.quick-dropdown-menu {
  position: fixed;
  min-width: 218px;
  padding: 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.35),
    0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 1000;
}

.quick-dropdown-item {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 10px;
  padding: 8px 10px;
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition:
    background-color 0.12s,
    color 0.12s;
}

.quick-dropdown-item:hover {
  background: var(--accent-color);
  color: #fff;
}

.quick-dropdown-item:hover .item-icon {
  color: #fff;
}

.quick-dropdown-item:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.quick-dropdown-item:disabled:hover {
  color: var(--text-primary);
  background: transparent;
}

.window-btn {
  width: 46px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  transition:
    background-color 0.15s,
    color 0.15s;
}

.window-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.window-btn.active {
  background: var(--bg-secondary);
  color: var(--accent-color);
}

.theme-btn {
  width: 40px;
}

.window-btn-close {
  border-radius: 0;
}

.window-btn-close:hover {
  background: #e81163;
  color: white;
}

body.window-maximized .topbar {
  border-radius: 0;
}

body.window-maximized .window-btn-close {
  border-radius: 0;
}

/* 响应式：在小屏幕上隐藏中间的项目名称 */
@media (max-width: 900px) {
  .project-name {
    display: none;
  }
}
</style>
