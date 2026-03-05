import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import type { Editor } from '../core/Editor'
import type { EditorTheme } from '../core/Theme'
import type { IPlugin, ViewportTransform } from './IPlugin'

export interface RulerOptions {
  /** 标尺厚度 (默认 20) */
  thickness?: number
  /** 文字大小 (默认 9) */
  fontSize?: number
}

const DEFAULT_OPTIONS: Required<RulerOptions> = {
  thickness: 20,
  fontSize: 9
}

/** 标尺刻度级别 */
const TICK_INTERVALS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

export class RulerPlugin implements IPlugin {
  readonly name = 'ruler'

  private editor: Editor | null = null
  private options: Required<RulerOptions>
  private _enabled = true

  private container: Container | null = null
  private horizontalRuler: Container | null = null
  private verticalRuler: Container | null = null
  private cornerBox: Graphics | null = null

  private hBackground: Graphics | null = null
  private vBackground: Graphics | null = null
  private hTicks: Graphics | null = null
  private vTicks: Graphics | null = null
  private hLabels: Container | null = null
  private vLabels: Container | null = null

  private textStyle: TextStyle

  constructor(options: RulerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    // 默认文字样式，会在 install 时根据主题更新
    this.textStyle = new TextStyle({
      fontSize: this.options.fontSize,
      fill: '#aaaaaa',
      fontFamily: 'JetBrains Mono, Monaco, Consolas, monospace'
    })
  }

  install(editor: Editor): void {
    this.editor = editor

    // 根据编辑器主题更新文字样式
    this.updateTextStyle(editor.theme)

    const overlay = editor.overlay
    if (!overlay) return

    // 创建标尺容器
    this.container = new Container()
    this.container.visible = this._enabled
    overlay.addChild(this.container)

    // 创建水平标尺
    this.horizontalRuler = new Container()
    this.hBackground = new Graphics()
    this.hTicks = new Graphics()
    this.hLabels = new Container()
    this.horizontalRuler.addChild(this.hBackground, this.hTicks, this.hLabels)
    this.container.addChild(this.horizontalRuler)

    // 创建垂直标尺
    this.verticalRuler = new Container()
    this.vBackground = new Graphics()
    this.vTicks = new Graphics()
    this.vLabels = new Container()
    this.verticalRuler.addChild(this.vBackground, this.vTicks, this.vLabels)
    this.container.addChild(this.verticalRuler)

    // 创建左上角方块
    this.cornerBox = new Graphics()
    this.container.addChild(this.cornerBox)

    // 初始绘制
    const { width, height } = editor.size
    this.drawRulers(width, height, editor.getTransform())
  }

  /** 启用/禁用插件 */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled
    if (this.container) {
      this.container.visible = enabled
    }
    // 如果重新启用，立即触发一次重绘
    if (enabled && this.editor) {
      const { width, height } = this.editor.size
      this.drawRulers(width, height, this.editor.getTransform())
    }
  }

  /** 获取插件启用状态 */
  isEnabled(): boolean {
    return this._enabled
  }

  /** 更新文字样式 */
  private updateTextStyle(theme: EditorTheme): void {
    this.textStyle = new TextStyle({
      fontSize: this.options.fontSize,
      fill: theme.rulerTextColor,
      fontFamily: 'JetBrains Mono, Monaco, Consolas, monospace'
    })
  }

  uninstall(): void {
    if (this.container && this.editor?.overlay) {
      this.editor.overlay.removeChild(this.container)
      this.container.destroy({ children: true })
    }

    this.container = null
    this.horizontalRuler = null
    this.verticalRuler = null
    this.cornerBox = null
    this.hBackground = null
    this.vBackground = null
    this.hTicks = null
    this.vTicks = null
    this.hLabels = null
    this.vLabels = null
    this.editor = null
  }

  onViewportChange(transform: ViewportTransform): void {
    if (!this.editor || !this._enabled) return
    const { width, height } = this.editor.size
    this.drawRulers(width, height, transform)
  }

  onResize(width: number, height: number): void {
    if (!this.editor || !this._enabled) return
    this.drawRulers(width, height, this.editor.getTransform())
  }

  onThemeChange(theme: EditorTheme): void {
    if (!this.editor) return
    this.updateTextStyle(theme)
    if (this._enabled) {
      const { width, height } = this.editor.size
      this.drawRulers(width, height, this.editor.getTransform())
    }
  }

  /** 根据缩放计算合适的刻度间隔 */
  private calculateTickInterval(scale: number): number {
    // 目标：每个刻度在屏幕上大约 50-100 像素
    const targetScreenInterval = 80
    const worldInterval = targetScreenInterval / scale

    // 找到最接近的刻度级别
    for (const interval of TICK_INTERVALS) {
      if (interval >= worldInterval) {
        return interval
      }
    }
    return TICK_INTERVALS[TICK_INTERVALS.length - 1]
  }

  /** 绘制标尺 */
  private drawRulers(
    screenWidth: number,
    screenHeight: number,
    transform: ViewportTransform
  ): void {
    if (!this.editor || !this._enabled) return

    const { thickness } = this.options
    const theme = this.editor.theme
    const backgroundColor = theme.rulerBackground
    const tickColor = theme.rulerTickColor

    // 绘制左上角方块
    if (this.cornerBox) {
      this.cornerBox.clear()
      this.cornerBox.rect(0, 0, thickness, thickness)
      this.cornerBox.fill(backgroundColor)
    }

    // 计算刻度间隔
    const tickInterval = this.calculateTickInterval(transform.scale)
    const subTickCount = 10 // 小刻度数量

    // 绘制水平标尺
    this.drawHorizontalRuler(
      screenWidth,
      transform,
      tickInterval,
      subTickCount,
      thickness,
      backgroundColor,
      tickColor
    )

    // 绘制垂直标尺
    this.drawVerticalRuler(
      screenHeight,
      transform,
      tickInterval,
      subTickCount,
      thickness,
      backgroundColor,
      tickColor
    )
  }

  /** 绘制水平标尺 */
  private drawHorizontalRuler(
    screenWidth: number,
    transform: ViewportTransform,
    tickInterval: number,
    subTickCount: number,
    thickness: number,
    backgroundColor: number,
    tickColor: number
  ): void {
    if (!this.hBackground || !this.hTicks || !this.hLabels) return

    // 清空
    this.hBackground.clear()
    this.hTicks.clear()
    this.hLabels.removeChildren()

    // 背景
    this.hBackground.rect(thickness, 0, screenWidth - thickness, thickness)
    this.hBackground.fill(backgroundColor)

    // 计算可见的世界坐标范围
    const worldStartX = -transform.x / transform.scale
    const worldEndX = (screenWidth - transform.x) / transform.scale

    // 计算起始刻度
    const startTick = Math.floor(worldStartX / tickInterval) * tickInterval
    const subInterval = tickInterval / subTickCount

    // 绘制刻度
    this.hTicks.setStrokeStyle({ width: 1, color: tickColor })

    // 为了避免文字重叠，保证相邻文字在屏幕上的间距至少 40 像素
    const minLabelScreenInterval = 40
    let lastLabelScreenX = -Infinity

    for (let worldX = startTick; worldX <= worldEndX; worldX += subInterval) {
      const screenX = worldX * transform.scale + transform.x

      if (screenX < thickness) continue

      const isMajor = Math.abs(worldX % tickInterval) < 0.01
      const tickHeight = isMajor ? thickness * 0.6 : thickness * 0.3

      this.hTicks.moveTo(screenX, thickness - tickHeight)
      this.hTicks.lineTo(screenX, thickness)
      this.hTicks.stroke()

      // 主刻度添加文字（根据屏幕间距筛选，避免重叠）
      if (isMajor && screenX - lastLabelScreenX >= minLabelScreenInterval) {
        const label = new Text({
          text: this.formatNumber(worldX),
          style: this.textStyle
        })
        label.x = screenX + 2
        label.y = 2
        this.hLabels.addChild(label)
        lastLabelScreenX = screenX
      }
    }
  }

  /** 绘制垂直标尺 */
  private drawVerticalRuler(
    screenHeight: number,
    transform: ViewportTransform,
    tickInterval: number,
    subTickCount: number,
    thickness: number,
    backgroundColor: number,
    tickColor: number
  ): void {
    if (!this.vBackground || !this.vTicks || !this.vLabels) return

    // 清空
    this.vBackground.clear()
    this.vTicks.clear()
    this.vLabels.removeChildren()

    // 背景
    this.vBackground.rect(0, thickness, thickness, screenHeight - thickness)
    this.vBackground.fill(backgroundColor)

    // 计算可见的世界坐标范围
    const worldStartY = -transform.y / transform.scale
    const worldEndY = (screenHeight - transform.y) / transform.scale

    // 计算起始刻度
    const startTick = Math.floor(worldStartY / tickInterval) * tickInterval
    const subInterval = tickInterval / subTickCount

    // 绘制刻度
    this.vTicks.setStrokeStyle({ width: 1, color: tickColor })

    // 垂直方向同样避免文字重叠
    const minLabelScreenInterval = 40
    let lastLabelScreenY = -Infinity

    for (let worldY = startTick; worldY <= worldEndY; worldY += subInterval) {
      const screenY = worldY * transform.scale + transform.y

      if (screenY < thickness) continue

      const isMajor = Math.abs(worldY % tickInterval) < 0.01
      const tickWidth = isMajor ? thickness * 0.6 : thickness * 0.3

      this.vTicks.moveTo(thickness - tickWidth, screenY)
      this.vTicks.lineTo(thickness, screenY)
      this.vTicks.stroke()

      // 主刻度添加文字（根据屏幕间距筛选，避免重叠）
      if (isMajor && screenY - lastLabelScreenY >= minLabelScreenInterval) {
        const label = new Text({
          text: this.formatNumber(worldY),
          style: this.textStyle
        })
        // 垂直标尺的文字旋转 90 度
        label.rotation = -Math.PI / 2
        label.x = thickness - 4
        label.y = screenY - 2
        label.anchor.set(0, 1)
        this.vLabels.addChild(label)
        lastLabelScreenY = screenY
      }
    }
  }

  /** 格式化数字显示 */
  private formatNumber(value: number): string {
    if (Math.abs(value) < 0.01) return '0'
    return value.toFixed(0)
  }
}

