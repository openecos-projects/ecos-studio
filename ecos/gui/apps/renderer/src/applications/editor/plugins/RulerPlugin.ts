import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import type { Editor } from '../core/Editor'
import type { EditorTheme } from '../core/Theme'
import type { IPlugin, ViewportTransform } from './IPlugin'
import { RULER_THICKNESS } from '../core/rulerConfig'

export interface RulerOptions {
  /** 标尺厚度 (默认 20) */
  thickness?: number
  /** 文字大小 (默认 9) */
  fontSize?: number
}

const DEFAULT_OPTIONS: Required<RulerOptions> = {
  thickness: RULER_THICKNESS,
  fontSize: 9
}

/** 1-2-5 序列乘数，用于在任意数量级上选择合适的刻度间隔 */
const NICE_MULTIPLIERS = [1, 2, 5]

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

    // 创建水平标尺（贴在画布底部，见 drawRulers 中更新 y）
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

  /** 根据缩放计算合适的刻度间隔（支持任意数量级） */
  private calculateTickInterval(scale: number): number {
    const targetScreenInterval = 80
    const worldInterval = targetScreenInterval / scale

    // 通过 1-2-5 序列在任意数量级上找到 >= worldInterval 的最小 "nice" 值
    const mag = Math.pow(10, Math.floor(Math.log10(worldInterval)))
    for (const m of NICE_MULTIPLIERS) {
      if (m * mag >= worldInterval) return m * mag
    }
    return 10 * mag
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

    // 水平标尺在画布底部；左下角方块与垂直标尺、水平标尺衔接
    if (this.horizontalRuler) {
      this.horizontalRuler.position.set(0, screenHeight - thickness)
    }
    if (this.cornerBox) {
      this.cornerBox.position.set(0, screenHeight - thickness)
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
      this.editor.worldHeight,
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

    const labelGap = 12
    const charWidth = this.options.fontSize * 0.65
    let lastLabelEndX = -Infinity

    for (let worldX = startTick; worldX <= worldEndX; worldX += subInterval) {
      const screenX = worldX * transform.scale + transform.x

      if (screenX < thickness) continue

      const isMajor = Math.abs(worldX % tickInterval) < 0.01
      const tickHeight = isMajor ? thickness * 0.6 : thickness * 0.3

      this.hTicks.moveTo(screenX, thickness - tickHeight)
      this.hTicks.lineTo(screenX, thickness)
      this.hTicks.stroke()

      if (isMajor && screenX >= lastLabelEndX + labelGap) {
        const text = this.formatNumber(worldX)
        const label = new Text({ text, style: this.textStyle })
        label.x = screenX + 2
        label.y = 2
        this.hLabels.addChild(label)
        lastLabelEndX = screenX + 2 + text.length * charWidth
      }
    }
  }

  /** 绘制垂直标尺 */
  private drawVerticalRuler(
    screenHeight: number,
    worldHeight: number,
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

    // 背景（水平标尺在底部，左侧条从顶到底部条上沿）
    this.vBackground.rect(0, 0, thickness, screenHeight - thickness)
    this.vBackground.fill(backgroundColor)

    // 垂直方向：在「显示坐标 displayY」上取刻度（与水平方向在 worldX 上取刻度对称），
    // displayY = worldHeight - worldY，底边为 0、向上为正；避免按 worldY 网格取样导致 0 落在格点外而需强行插入刻度。
    const worldStartY = -transform.y / transform.scale
    const worldEndY = (screenHeight - transform.y) / transform.scale

    const displayMin = worldHeight - worldEndY
    const displayMax = worldHeight - worldStartY

    const subInterval = tickInterval / subTickCount
    const startTick = Math.floor(displayMin / subInterval) * subInterval

    // 绘制刻度
    this.vTicks.setStrokeStyle({ width: 1, color: tickColor })

    const minLabelScreenInterval = 40
    let lastLabelScreenY = -Infinity

    for (let displayY = startTick; displayY <= displayMax + 1e-6; displayY += subInterval) {
      const worldY = worldHeight - displayY
      const screenY = worldY * transform.scale + transform.y

      if (screenY >= screenHeight - thickness) continue

      const isMajor =
        Math.abs(displayY / tickInterval - Math.round(displayY / tickInterval)) < 1e-5
      const tickWidth = isMajor ? thickness * 0.6 : thickness * 0.3

      this.vTicks.moveTo(thickness - tickWidth, screenY)
      this.vTicks.lineTo(thickness, screenY)
      this.vTicks.stroke()

      // displayY 递增时 worldY 递减，screenY 沿屏幕向上变小，不能用 screenY - last（会为负）；用屏幕距
      if (isMajor && Math.abs(screenY - lastLabelScreenY) >= minLabelScreenInterval) {
        const label = new Text({
          text: this.formatNumber(displayY),
          style: this.textStyle
        })
        label.rotation = -Math.PI / 2
        label.x = thickness - 4
        label.y = screenY - 2
        label.anchor.set(0, 1)
        this.vLabels.addChild(label)
        lastLabelScreenY = screenY
      }
    }
  }

  /** 格式化数字显示（大数字用 K/M 后缀缩短） */
  private formatNumber(value: number): string {
    const abs = Math.abs(value)
    if (abs < 0.01) return '0'
    if (abs >= 1_000_000) {
      const v = value / 1_000_000
      return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'M'
    }
    if (abs >= 10_000) {
      const v = value / 1_000
      return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + 'K'
    }
    return value.toFixed(0)
  }
}

