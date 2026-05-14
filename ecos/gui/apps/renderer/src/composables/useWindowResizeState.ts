import { ref, readonly } from 'vue'

/**
 * 全局窗口缩放状态。
 *
 * 由 App.vue 在检测到 Tauri `onResized` / `startResizeDragging` 时设置为 true，
 * 停歇若干毫秒后自动回到 false。组件可以订阅这个状态，在窗口正在拖拽缩放期间
 * 跳过昂贵的重绘（例如 ECharts 的 canvas resize、Layout 图片重采样等），
 * 并在 resize 结束时进行一次精确恢复。
 *
 * 设计成模块级单例以便跨组件共享，并以 readonly 形式导出，避免消费方误写。
 */
const _isWindowResizing = ref(false)

export function setWindowResizing(value: boolean): void {
  _isWindowResizing.value = value
}

export const isWindowResizing = readonly(_isWindowResizing)
