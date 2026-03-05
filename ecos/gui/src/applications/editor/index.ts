import { Editor, type EditorOptions } from './core/Editor'
import { RulerPlugin, SelectPlugin, HighlightPlugin, MeasurePlugin, LayerManagerPlugin } from './plugins'

// 导出核心类
export { Editor }
export type { EditorOptions } from './core/Editor'

// 导出主题
export { themes, lightTheme, darkTheme } from './core/Theme'
export type { EditorTheme, ThemeName } from './core/Theme'

// 导出插件
export * from './plugins'

// 导出 layout 模块
export * from './layout'

// 导出组件
export { default as EditorContainer } from './EditorContainer.vue'

/**
 * 创建预配置的默认编辑器
 * 包含: RulerPlugin, SelectPlugin, HighlightPlugin, MeasurePlugin, LayerManagerPlugin
 * @param options 编辑器选项 (可选)
 */
export function createDefaultEditor(options?: EditorOptions): Editor {
  const editor = new Editor(options)
  editor.use([
    new RulerPlugin(),
    new SelectPlugin(),
    new HighlightPlugin(),
    new MeasurePlugin(),
    new LayerManagerPlugin(),
  ])
  return editor
}

/**
 * 创建空白编辑器 (无默认插件)
 * @param options 编辑器选项 (可选)
 */
export function createEditor(options?: EditorOptions): Editor {
  return new Editor(options)
}

