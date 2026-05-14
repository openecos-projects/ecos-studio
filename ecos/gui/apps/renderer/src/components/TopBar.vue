<template>
  <div class="topbar">
    <!-- 左侧：应用图标和菜单栏 -->
    <div class="topbar-left" @mousedown.stop>
      <!-- 应用图标 -->
      <div class="app-icon">
        <i class="ri-cpu-line"></i>
      </div>

      <button
        v-if="!isEcosHome"
        @click="handleGoHome"
        class="home-btn"
        type="button"
        title="Back to Home"
        aria-label="Back to Home"
      >
        <i class="ri-home-4-line"></i>
      </button>

      <!-- 菜单项（带下拉菜单） -->
      <div class="menu-items" ref="menuBarRef">
        <div v-for="menu in menus" :key="menu.label" class="menu-wrapper">
          <button @click="toggleMenu(menu.action)" @mouseenter="handleMenuHover(menu.action)" class="menu-btn"
            :class="{ 'menu-btn-active': activeMenu === menu.action }">
            {{ menu.label }}
          </button>
          <!-- 下拉菜单 -->
          <Transition name="dropdown">
            <div v-if="activeMenu === menu.action && menu.children" class="dropdown-menu">
              <template v-for="(item, idx) in menu.children" :key="idx">
                <div v-if="item.separator" class="dropdown-separator" />
                <button v-else @click="handleItemClick(item.event)" class="dropdown-item" :disabled="item.disabled">
                  <i v-if="item.icon" :class="item.icon" class="item-icon" />
                  <span class="item-label">{{ item.label }}</span>
                  <span v-if="item.shortcut" class="item-shortcut">{{ item.shortcut }}</span>
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
      <button v-if="isWelcome" @click="toggleTheme" class="window-btn theme-btn"
        :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'">
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
          <svg v-if="!isMaximized" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1" />
          </svg>
          <!-- 还原：重叠双框 -->
          <svg v-else width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="4.5" y="4.5" width="7.5" height="7.5" fill="none" stroke="currentColor" stroke-width="1" />
            <rect x="2.5" y="2.5" width="7.5" height="7.5" fill="none" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
        <!-- 关闭 -->
        <button @click="handleClose" class="window-btn window-btn-close" aria-label="Close window">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AppMenuAction } from '@ecos-studio/shared'
import { appMenuActionIds } from '@ecos-studio/shared'
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useThemeStore } from '@/stores/themeStore'
import { useRoute, useRouter } from 'vue-router'
import type { DesktopApi } from '@ecos-studio/shared'
import { getOptionalDesktopApi, waitForDesktopApi } from '@/platform/desktop'
// ---- 类型定义 ----
interface DropdownItem {
  label?: string
  icon?: string
  shortcut?: string
  event?: AppMenuAction
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
const isWelcome = computed(() => route.path === '/')
const isEcosHome = computed(() => route.name === 'ECOS')
// ---- Props & Emits ----
const props = defineProps<{
  projectName?: string | null
}>()

const emit = defineEmits<{
  (e: 'menu-action', action: AppMenuAction): void
}>()

const themeStore = useThemeStore()
const isDark = computed(() => themeStore.themeName === 'dark')
const desktopApi = ref<DesktopApi | null>(getOptionalDesktopApi())
const toggleTheme = () => {
  themeStore.toggleTheme()
}

const handleGoHome = () => {
  activeMenu.value = null
  router.push({ name: 'ECOS' })
}

// ---- 菜单配置 ----
const menus: Menu[] = [
  {
    label: 'File',
    action: 'file',
    children: [
      { label: 'New Workspace', icon: 'ri-add-line', shortcut: '⌘N', event: appMenuActionIds.newProject },
      { label: 'Open Workspace', icon: 'ri-folder-open-line', shortcut: '⌘O', event: appMenuActionIds.openProject },
      // { separator: true },
    ]
  },
  {
    label: 'Help',
    action: 'help',
    children: [
      { label: 'Documentation', icon: 'ri-book-open-line', event: appMenuActionIds.documentation },
      { separator: true },
      { label: 'About', icon: 'ri-information-line', event: appMenuActionIds.about },
    ]
  }
]

// ---- 下拉菜单状态 ----
const activeMenu = ref<string | null>(null)
const menuBarRef = ref<HTMLElement | null>(null)

/** 切换菜单展开/收起 */
const toggleMenu = (action: string) => {
  activeMenu.value = activeMenu.value === action ? null : action
}

/** 鼠标悬浮切换（仅当已有菜单打开时） */
const handleMenuHover = (action: string) => {
  if (activeMenu.value && activeMenu.value !== action) {
    activeMenu.value = action
  }
}

/** 下拉项点击 */
const handleItemClick = (event?: AppMenuAction) => {
  activeMenu.value = null
  if (event) {
    emit('menu-action', event)
  }
}

/** 点击菜单栏外部关闭 */
const handleClickOutside = (e: MouseEvent) => {
  if (menuBarRef.value && !menuBarRef.value.contains(e.target as Node)) {
    activeMenu.value = null
  }
}

/** Escape 键关闭 */
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    activeMenu.value = null
  }
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

  if (!desktopApi.value) {
    try {
      desktopApi.value = await waitForDesktopApi({ timeoutMs: 5000 })
    } catch (error) {
      console.warn('[TopBar] Desktop bridge did not become available in time:', error)
      return
    }
  }

  void syncMaximizedState()
  unlistenMaximizedChanged = desktopApi.value.window.onMaximizedChanged((nextIsMaximized) => {
    isMaximized.value = nextIsMaximized
  })
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
  unlistenMaximizedChanged?.()
})

// ---- 窗口控制 ----
const handleMinimize = async () => {
  const api = desktopApi.value ?? await waitForDesktopApi()
  await api.window.minimize()
}

const handleMaximize = async () => {
  const api = desktopApi.value ?? await waitForDesktopApi()
  await api.window.toggleMaximize()
}

const handleClose = async () => {
  const api = desktopApi.value ?? await waitForDesktopApi()
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
  cursor: default;
}

/* 左侧区域 */
.topbar-left {
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: 16px;
  gap: 8px;
  z-index: 10;
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

.home-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  transition: color 0.15s, background-color 0.15s;
}

.home-btn:hover {
  color: var(--text-primary);
  background: var(--bg-secondary);
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
  transition: color 0.15s, background-color 0.15s;
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
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.2);
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
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
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
  transition: background-color 0.15s, color 0.15s;
}

.window-btn:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
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
