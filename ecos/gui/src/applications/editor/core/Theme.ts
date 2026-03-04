/** 编辑器主题配置 */
export interface EditorTheme {
  /** 主题名称 */
  name: string
  /** 背景颜色 */
  backgroundColor: number
  /** 标尺背景颜色 */
  rulerBackground: number
  /** 标尺刻度颜色 */
  rulerTickColor: number
  /** 标尺文字颜色 */
  rulerTextColor: string
  /** 网格线颜色 */
  gridColor: number
  /** 网格线透明度 */
  gridAlpha: number
  /** 调试边框颜色 */
  debugBorderColor: number
  /** 调试中心线颜色 */
  debugCenterColor: number
}

/** 亮色主题 */
export const lightTheme: EditorTheme = {
  name: 'light',
  backgroundColor: 0xf5f5f5,
  rulerBackground: 0xe8e8e8,
  rulerTickColor: 0x666666,
  rulerTextColor: '#555555',
  gridColor: 0xcccccc,
  gridAlpha: 0.5,
  debugBorderColor: 0x3498db,
  debugCenterColor: 0xe74c3c
}

/** 暗色主题 */
export const darkTheme: EditorTheme = {
  name: 'dark',
  backgroundColor: 0x1a1a2e,
  rulerBackground: 0x252536,
  rulerTickColor: 0x888888,
  rulerTextColor: '#aaaaaa',
  gridColor: 0x444444,
  gridAlpha: 0.3,
  debugBorderColor: 0x5dade2,
  debugCenterColor: 0xec7063
}

/** 预设主题 */
export const themes = {
  light: lightTheme,
  dark: darkTheme
} as const

export type ThemeName = keyof typeof themes

