<template>
  <div class="topbar" @dblclick="handleDoubleClick" @mousedown="handleMouseDown">
    <!-- 左侧：应用图标和菜单栏 -->
    <div class="topbar-left" @mousedown.stop>
      <!-- 应用图标 -->
      <div class="app-icon">
        <i class="ri-cpu-line"></i>
      </div>

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

    <div class="topbar-center">
      <span class="project-name">{{ props.projectName }}</span>
    </div>

    <!-- 右侧：窗口控制按钮 -->
    <div class="topbar-right" @mousedown.stop>
      <button @click="toggleTheme" class="window-btn theme-btn"
        :title="isDark ? 'Switch to light theme' : 'Switch to dark theme'">
        <i :class="isDark ? 'ri-sun-line' : 'ri-moon-line'" class="text-base"></i>
      </button>
      <!-- 最小化 -->
      <button @click="handleMinimize" class="window-btn" title="Minimize">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
        </svg>
      </button>
      <!-- 最大化/还原 -->
      <button @click="handleMaximize" class="window-btn" title="Maximize">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <rect x="2" y="2" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <!-- 关闭 -->
      <button @click="handleClose" class="window-btn window-btn-close" title="Close">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useThemeStore } from '@/stores/themeStore'

// ---- 类型定义 ----
interface DropdownItem {
  label?: string
  icon?: string
  shortcut?: string
  event?: string
  separator?: boolean
  disabled?: boolean
}

interface Menu {
  label: string
  action: string
  children?: DropdownItem[]
}

// ---- Props & Emits ----
const props = defineProps<{
  projectName?: string
}>()

const emit = defineEmits<{
  (e: 'menu-action', action: string): void
}>()

const themeStore = useThemeStore()
const isDark = computed(() => themeStore.themeName === 'dark')
const toggleTheme = () => {
  themeStore.toggleTheme()
}

// ---- 菜单配置 ----
const menus: Menu[] = [
  {
    label: 'File',
    action: 'file',
    children: [
      { label: 'New Workspace', icon: 'ri-add-line', shortcut: '⌘N', event: 'new-project' },
      { label: 'Open Workspace', icon: 'ri-folder-open-line', shortcut: '⌘O', event: 'open-project' },
      // { separator: true },
    ]
  },
  {
    label: 'Help',
    action: 'help',
    children: [
      { label: 'Documentation', icon: 'ri-book-open-line', event: 'documentation' },
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
const handleItemClick = (event?: string) => {
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

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})

// ---- 窗口控制 ----
const handleMinimize = () => {
  invoke('window_minimize')
}

const handleMaximize = () => {
  invoke('window_maximize')
}

const handleClose = () => {
  invoke('window_close')
}

// 拖拽窗口 - 阻止文字选择并启动拖拽
const handleMouseDown = async (event: MouseEvent) => {
  event.preventDefault()
  const target = event.target as HTMLElement
  if (target.closest('button') || target.closest('input') || target.closest('textarea')) {
    return
  }
  await getCurrentWindow().startDragging()
}

// 双击标题栏空白区域切换最大化/还原
const handleDoubleClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (target.closest('button')) {
    return
  }
  invoke('window_maximize')
}
</script>

<style scoped>
.topbar {
  height: 40px;
  background: var(--topbar-bg);
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
  -webkit-user-select: none;
  border-radius: 9px 9px 0 0;
  border-bottom: 1px solid var(--border-color);
  position: relative;
  -webkit-app-region: drag;
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

/* 中间拖拽区域 - 始终居中 */
.topbar-center {
  position: absolute;
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
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
  border-radius: 0 10px 0 0;
}

.window-btn-close:hover {
  background: #e81163;
  color: white;
}

/* 响应式：在小屏幕上隐藏中间的项目名称 */
@media (max-width: 900px) {
  .project-name {
    display: none;
  }
}
</style>
