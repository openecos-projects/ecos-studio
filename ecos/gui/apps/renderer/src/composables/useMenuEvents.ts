/**
 * 原生菜单事件监听
 *
 * 用于监听桌面壳层转发到 renderer 的原生菜单点击事件
 */

import { onMounted, onUnmounted } from 'vue'
import type { DesktopMenuEventId } from '@ecos-studio/shared'
import { getDesktopApi } from '@/platform/desktop'

export type MenuEventId = DesktopMenuEventId

type MenuEventHandler = () => void

/**
 * 监听原生菜单事件
 *
 * @example
 * ```ts
 * useMenuEvents({
 *   new_project: () => { console.log('New project clicked') },
 *   open_project: () => { openProjectDialog() },
 *   save: () => { saveCurrentProject() },
 * })
 * ```
 */
export function useMenuEvents(handlers: Partial<Record<MenuEventId, MenuEventHandler>>) {
  let unsubscribe: (() => void) | undefined

  onMounted(() => {
    unsubscribe = getDesktopApi().menu.onAction((eventId) => {
      handlers[eventId]?.()
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })
}

/**
 * 监听单个菜单事件
 *
 * @example
 * ```ts
 * useMenuEvent('new_project', () => {
 *   showNewProjectDialog.value = true
 * })
 * ```
 */
export function useMenuEvent(eventId: MenuEventId, handler: MenuEventHandler) {
  useMenuEvents({ [eventId]: handler })
}
