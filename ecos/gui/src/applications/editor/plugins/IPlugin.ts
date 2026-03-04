import type { Editor } from '../core/Editor'
import type { EditorTheme } from '../core/Theme'

/** Viewport 变换信息 */
export interface ViewportTransform {
  /** X 方向偏移 (屏幕坐标) */
  x: number
  /** Y 方向偏移 (屏幕坐标) */
  y: number
  /** 缩放比例 */
  scale: number
}

/** 插件接口 */
export interface IPlugin {
  /** 插件名称 (唯一标识) */
  readonly name: string

  /**
   * 安装插件
   * @param editor 编辑器实例
   */
  install(editor: Editor): void

  /**
   * 卸载插件
   */
  uninstall(): void

  /**
   * 启用/禁用插件
   */
  setEnabled?(enabled: boolean): void

  /**
   * 获取插件启用状态
   */
  isEnabled?(): boolean

  /**
   * Viewport 变化回调 (平移/缩放)
   * @param transform 当前变换信息
   */
  onViewportChange?(transform: ViewportTransform): void

  /**
   * 画布尺寸变化回调
   * @param width 新宽度
   * @param height 新高度
   */
  onResize?(width: number, height: number): void

  /**
   * 主题变化回调
   * @param theme 新主题
   */
  onThemeChange?(theme: EditorTheme): void
}

