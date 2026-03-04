/**
 * 原生菜单事件监听
 * 
 * 用于监听 Tauri 原生菜单的点击事件
 */

import { onMounted, onUnmounted } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from './useTauri'

export type MenuEventId = 
  | 'new_project'
  | 'open_project'
  | 'save'
  | 'save_as'
  | 'toggle_sidebar'
  | 'toggle_inspector'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_reset'
  | 'documentation'
  | 'release_notes'
  | 'report_issue'

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
  const unlisteners: UnlistenFn[] = []

  onMounted(async () => {
    if (!isTauri()) return

    for (const [eventId, handler] of Object.entries(handlers)) {
      if (handler) {
        try {
          const unlisten = await listen(`menu:${eventId}`, () => {
            handler()
          })
          unlisteners.push(unlisten)
        } catch (e) {
          console.error(`Failed to listen to menu:${eventId}`, e)
        }
      }
    }
  })

  onUnmounted(() => {
    unlisteners.forEach(unlisten => unlisten())
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
