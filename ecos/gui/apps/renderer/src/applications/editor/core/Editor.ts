import { Application, Container, Sprite, Assets, Texture } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import type { IPlugin, ViewportTransform } from '../plugins/IPlugin'
import { themes, darkTheme, type EditorTheme, type ThemeName } from './Theme'
import { RULER_THICKNESS } from './rulerConfig'
import { worldPointFromDisplay, displayPointFromWorld } from './editorCoordinates'

export interface EditorOptions {
  /** 世界宽度 (默认 4000) */
  worldWidth?: number
  /** 世界高度 (默认 4000) */
  worldHeight?: number
  /** 主题名称 (默认 'dark') */
  theme?: ThemeName
}

/** fitToWorld：在 Pixi 世界坐标中要对准到标尺绘图区中心的目标点（默认可为 die 几何中心） */
export interface FitToWorldOptions {
  worldCenter?: { x: number; y: number }
}

const DEFAULT_OPTIONS: Required<EditorOptions> = {
  worldWidth: 4000,
  worldHeight: 4000,
  theme: 'dark'
}

export class Editor {
  private app: Application | null = null
  private viewport: Viewport | null = null
  private container: HTMLElement | null = null
  private plugins: IPlugin[] = []
  private options: Required<EditorOptions>
  private resizeObserver: ResizeObserver | null = null
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private _initialized = false
  private _theme: EditorTheme
  private transformListeners = new Set<(t: ViewportTransform) => void>()

  /** 用于插件添加固定在屏幕坐标的 UI 元素 */
  private overlayContainer: Container | null = null

  /** 用于显示 EDA 生成的底图/热力图的容器 */
  private backgroundContainer: Container | null = null

  /** 当前背景图的 blob URL，用于清理 */
  private currentBlobUrl: string | null = null

  /** 上次 resize 时的屏幕尺寸，用于在窗口尺寸变化时平移视口以保持世界坐标一致 */
  private _screenSizeForResize: { w: number; h: number } | null = null

  /**
   * 为 true 时表示当前视口由 fitToWorld/标尺内居中得到；容器尺寸变化时应对「留黑边」居中视图用半宽/半高 delta。
   * 为 false 时保持原全量平移（初始化标尺原点、用户拖拽等）。
   */
  private _resizeUsesCenteredUnderflowRule = false

  /** 防抖延迟时间 (ms) */
  private static readonly RESIZE_DEBOUNCE_DELAY = 16 // ~60fps

  constructor(options: EditorOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this._theme = themes[this.options.theme] || darkTheme
  }

  /** 获取当前主题 */
  get theme(): EditorTheme {
    return this._theme
  }

  /** 获取 Pixi Application 实例 */
  get application(): Application | null {
    return this.app
  }

  /** 获取 Viewport 实例 */
  get view(): Viewport | null {
    return this.viewport
  }

  /** 获取屏幕固定的 Overlay 容器 */
  get overlay(): Container | null {
    return this.overlayContainer
  }

  /** 获取当前画布尺寸 */
  get size(): { width: number; height: number } {
    return {
      width: this.app?.screen.width ?? 0,
      height: this.app?.screen.height ?? 0
    }
  }

  /** 世界宽度（与 viewport 一致，可被 setWorldBounds 更新） */
  get worldWidth(): number {
    return this.options.worldWidth
  }

  /** 世界高度（与 viewport 一致，可被 setWorldBounds 更新） */
  get worldHeight(): number {
    return this.options.worldHeight
  }

  /**
   * 显示/EDA 坐标（左下为原点、Y 向上，与标尺一致）→ Pixi 世界坐标（点）
   */
  public displayToWorld(displayX: number, displayY: number): { x: number; y: number } {
    return worldPointFromDisplay(displayX, displayY, this.options.worldHeight)
  }

  /**
   * Pixi 世界坐标 → 显示/EDA 坐标（左下为原点、Y 向上）
   */
  public worldToDisplay(worldX: number, worldY: number): { x: number; y: number } {
    return displayPointFromWorld(worldX, worldY, this.options.worldHeight)
  }

  /** 是否已初始化 */
  get initialized(): boolean {
    return this._initialized
  }

  /** 初始化编辑器 */
  async init(container: HTMLElement): Promise<void> {
    if (this._initialized) {
      console.warn('Editor already initialized')
      return
    }

    this.container = container
    const { width, height } = container.getBoundingClientRect()

    // 创建 Pixi Application (v8+ 异步初始化)
    this.app = new Application()
    await this.app.init({
      background: this._theme.backgroundColor,
      width,
      height,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      // 不指定 preference，让 PixiJS 自动选择最佳渲染器
      // Tauri 生产环境的 WebView 可能不支持 WebGPU
    })

    // 添加 canvas 到容器
    container.appendChild(this.app.canvas as HTMLCanvasElement)

    // 创建 Viewport
    this.viewport = new Viewport({
      screenWidth: width,
      screenHeight: height,
      worldWidth: this.options.worldWidth,
      worldHeight: this.options.worldHeight,
      events: this.app.renderer.events,
      ticker: this.app.ticker
    })

    // 启用 viewport 交互
    this.viewport
      .drag()
      .pinch()
      .wheel()
      .decelerate()
      .clampZoom({ minScale: 0.0001, maxScale: 30 })

    this.app.stage.addChild(this.viewport)

    // 创建背景容器 (在世界坐标系中，位于底层)
    this.backgroundContainer = new Container()
    this.viewport.addChildAt(this.backgroundContainer, 0)

    // 创建 Overlay 容器 (固定在屏幕坐标)
    this.overlayContainer = new Container()
    this.app.stage.addChild(this.overlayContainer)

    // 监听 viewport 变化
    this.viewport.on('moved', () => this.notifyViewportChange())
    this.viewport.on('zoomed', () => this.notifyViewportChange())

    // 监听容器尺寸变化 (带防抖)
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const { width, height } = entry.contentRect

      // 防抖处理
      if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer)
      }
      this.resizeDebounceTimer = setTimeout(() => {
        this.handleResize(width, height)
        this.resizeDebounceTimer = null
      }, Editor.RESIZE_DEBOUNCE_DELAY)
    })
    this.resizeObserver.observe(container)

    this._initialized = true

    // 视口对齐到标尺原点，使左下角为 X=0、Y 显示 0（与 RulerPlugin 的 worldHeight - worldY 一致）
    this.alignViewportToRulerOrigin()

    // 初始化所有已注册的插件
    for (const plugin of this.plugins) {
      plugin.install(this)
    }

    // 触发初始的 viewport 变化通知
    this.notifyViewportChange()
  }

  /** 注册插件 (支持单个或数组) */
  use(plugin: IPlugin | IPlugin[]): this {
    const plugins = Array.isArray(plugin) ? plugin : [plugin]
    const newPlugins: IPlugin[] = []

    for (const p of plugins) {
      if (this.plugins.some(existing => existing.name === p.name)) {
        console.warn(`Plugin "${p.name}" already registered`)
        continue
      }
      this.plugins.push(p)
      newPlugins.push(p)
    }

    // 如果编辑器已初始化，立即安装新插件
    if (this._initialized && newPlugins.length > 0) {
      for (const p of newPlugins) {
        p.install(this)
      }
      this.notifyViewportChange()
    }

    return this
  }

  /** 卸载插件 */
  remove(pluginName: string): this {
    const index = this.plugins.findIndex(p => p.name === pluginName)
    if (index !== -1) {
      const plugin = this.plugins[index]
      plugin.uninstall()
      this.plugins.splice(index, 1)
    }
    return this
  }

  /** 获取插件 */
  getPlugin<T extends IPlugin>(name: string): T | undefined {
    return this.plugins.find(p => p.name === name) as T | undefined
  }

  /** 设置指定插件的启用状态 */
  public setPluginEnabled(name: string, enabled: boolean): this {
    const plugin = this.getPlugin(name)
    if (plugin && typeof plugin.setEnabled === 'function') {
      plugin.setEnabled(enabled)
    }
    return this
  }

  /** 获取当前 viewport 变换信息 */
  getTransform(): ViewportTransform {
    if (!this.viewport) {
      return { x: 0, y: 0, scale: 1 }
    }
    return {
      x: this.viewport.x,
      y: this.viewport.y,
      scale: this.viewport.scale.x
    }
  }

  /** 获取当前缩放比例 */
  public getScale(): number {
    return this.getTransform().scale
  }

  /** 订阅变换更新 (缩放/平移) */
  public onTransformChange(cb: (t: ViewportTransform) => void): () => void {
    this.transformListeners.add(cb)
    return () => this.transformListeners.delete(cb)
  }

  /** 设置缩放比例 (基于画布中心) */
  public setZoom(scale: number): this {
    if (!this.viewport) return this

    const min = 0.1
    const max = 10
    const nextScale = Math.max(min, Math.min(max, scale))

    // 保持当前中心点进行缩放
    const center = this.viewport.center
    this.viewport.setZoom(nextScale, true)
    this.viewport.moveCenter(center.x, center.y)

    this.notifyViewportChange()
    return this
  }

  /** 放大 */
  public zoomIn(step = 0.1): this {
    return this.setZoom(this.getScale() * (1 + step))
  }

  /** 缩小 */
  public zoomOut(step = 0.1): this {
    return this.setZoom(this.getScale() / (1 + step))
  }

  /**
   * Update viewport world dimensions and zoom limits.
   * Call this when loading content with different coordinate ranges (e.g., layout DBU).
   */
  public setWorldBounds(worldWidth: number, worldHeight: number): this {
    if (!this.viewport) return this
    this.options.worldWidth = worldWidth
    this.options.worldHeight = worldHeight
    this.viewport.worldWidth = worldWidth
    this.viewport.worldHeight = worldHeight

    // 与 fitToWorld、viewport 一致使用同一套 screen 尺寸，避免 app.screen 与 viewport 不一致时 clampZoom 与真实视口错位（大 die + 小缩放时尤甚）
    const screenW = (this.viewport.screenWidth > 0 ? this.viewport.screenWidth : this.app?.screen.width) ?? 800
    const screenH = (this.viewport.screenHeight > 0 ? this.viewport.screenHeight : this.app?.screen.height) ?? 600
    const fitScale = Math.min(screenW / worldWidth, screenH / worldHeight)
    const minScale = fitScale * 0.5
    this.viewport.clampZoom({ minScale, maxScale: 100 })

    return this
  }

  /** 与 DOM 容器一致，避免 flex/遮罩刚消失时 viewport 尺寸滞后于真实画布 */
  private syncViewportSizeFromDom(): void {
    if (!this.viewport || !this.app || !this.container) return
    const r = this.container.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width))
    const h = Math.max(1, Math.round(r.height))
    if (w !== this.viewport.screenWidth || h !== this.viewport.screenHeight) {
      this.app.renderer.resize(w, h)
      this.viewport.resize(w, h)
    }
  }

  /** 适应所有元素/世界范围 */
  public fitToWorld(padding = 40, options?: FitToWorldOptions): this {
    if (!this.viewport || !this.app) return this

    this.syncViewportSizeFromDom()

    const screenW = this.viewport.screenWidth
    const screenH = this.viewport.screenHeight
    const R = RULER_THICKNESS
    // 可绘矩形：去掉左侧竖尺 + 底部横尺（与 RulerPlugin 一致）
    const drawableW = Math.max(1, screenW - R)
    const drawableH = Math.max(1, screenH - R)
    const sw = Math.max(1, drawableW - padding * 2)
    const sh = Math.max(1, drawableH - padding * 2)

    const scale = Math.min(
      sw / this.options.worldWidth,
      sh / this.options.worldHeight
    )

    this.viewport.setZoom(scale, false)
    this.alignViewportFittedWorldCentered(options)

    this.notifyViewportChange()
    return this
  }

  /**
   * 在左侧/底侧标尺围成的绘图区内，将 `worldCenter` 对准绘图区中心。
   * 使用 moveCenter 再平移，与 pixi-viewport 内部一致；随后 emit 以便瓦片刷新。
   */
  private alignViewportFittedWorldCentered(options?: FitToWorldOptions): this {
    if (!this.viewport || !this.app) return this
    const vp = this.viewport
    const ww = this.options.worldWidth
    const wh = this.options.worldHeight
    const cx = options?.worldCenter?.x ?? ww / 2
    const cy = options?.worldCenter?.y ?? wh / 2

    vp.moveCenter(cx, cy)
    vp.position.x += RULER_THICKNESS / 2
    vp.position.y -= RULER_THICKNESS / 2

    vp.emit('moved', { viewport: vp, type: 'animate' })
    vp.emit('zoomed', { viewport: vp, type: 'animate' })
    this._resizeUsesCenteredUnderflowRule = true
    this._screenSizeForResize = {
      w: vp.screenWidth,
      h: vp.screenHeight
    }
    return this
  }

  /**
   * 适应当前背景图：按留白完整显示图片，在标尺绘图区内居中（与 fitToWorld 一致）
   * @param padding 四周留白（像素）
   */
  public fit(padding = 10): this {
    if (!this.viewport || !this.app || !this.backgroundContainer) return this

    const backgroundSprite = this.backgroundContainer.children[0] as Sprite
    if (!backgroundSprite) {
      console.warn('No background image to fit')
      return this
    }

    const texture = backgroundSprite.texture
    const imgWidth = texture.width
    const imgHeight = texture.height

    if (imgWidth === 0 || imgHeight === 0) {
      console.warn('Background image has zero dimensions')
      return this
    }

    this.setWorldBounds(imgWidth, imgHeight)

    const R = RULER_THICKNESS
    const drawableW = Math.max(1, this.viewport.screenWidth - R)
    const drawableH = Math.max(1, this.viewport.screenHeight - R)
    const screenWidth = Math.max(1, drawableW - padding * 2)
    const screenHeight = Math.max(1, drawableH - padding * 2)

    const scale = Math.min(
      screenWidth / imgWidth,
      screenHeight / imgHeight
    )

    this.viewport.setZoom(scale, false)
    this.alignViewportFittedWorldCentered(undefined)
    this.notifyViewportChange()
    return this
  }

  /** 设置主题 */
  setTheme(themeName: ThemeName): this {
    const newTheme = themes[themeName]
    if (!newTheme) {
      console.warn(`Theme "${themeName}" not found`)
      return this
    }

    this._theme = newTheme

    // 更新背景颜色
    if (this.app) {
      this.app.renderer.background.color = newTheme.backgroundColor
    }

    // 通知插件主题变化
    this.notifyThemeChange()

    return this
  }

  /**
   * 设置编辑器背景图（如 EDA 生成的布局图）
   * @param url 图片的 Web URL (blob URL 或 asset protocol URL)
   */
  public async setBackgroundImage(url: string): Promise<void> {
    if (!this.backgroundContainer) return
    try {
      // 1. 释放旧的 blob URL
      if (this.currentBlobUrl && this.currentBlobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(this.currentBlobUrl)
        console.log('Revoked old blob URL:', this.currentBlobUrl)
      }

      // 2. 清除旧背景
      this.backgroundContainer.removeChildren().forEach(child => child.destroy())
      console.log('Removed old background children');

      // 3. 加载新纹理
      let texture: Texture
      if (url.startsWith('blob:')) {
        // 对于 blob URL，手动加载图片并创建纹理
        console.log('Loading blob URL...');
        const img = new Image()

        // 等待图片加载完成
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            console.log('Image loaded, dimensions:', img.width, 'x', img.height);
            resolve()
          }
          img.onerror = (err) => {
            console.error('Image load error:', err);
            reject(new Error('Failed to load image from blob URL'))
          }
          img.src = url
        })

        // 从 Image 元素创建纹理
        texture = Texture.from(img)
        // 配置纹理采样模式：
        // - minFilter: linear + mipmap，缩小时平滑混合，避免细节丢失
        // - magFilter: nearest，放大时保持像素锐利，不模糊
        texture.source.autoGenerateMipmaps = true
        texture.source.style.minFilter = 'linear'
        texture.source.style.mipmapFilter = 'linear'
        texture.source.style.magFilter = 'nearest'
      } else {
        // 对于其他 URL，使用 Assets.load
        texture = await Assets.load(url)
        // 配置纹理采样模式：
        // - minFilter: linear + mipmap，缩小时平滑混合，避免细节丢失
        // - magFilter: nearest，放大时保持像素锐利，不模糊
        texture.source.autoGenerateMipmaps = true
        texture.source.style.minFilter = 'linear'
        texture.source.style.mipmapFilter = 'linear'
        texture.source.style.magFilter = 'nearest'
      }

      const imgW = texture.width
      const imgH = texture.height
      if (imgW === 0 || imgH === 0) {
        throw new Error('Background texture has zero dimensions')
      }

      // 世界范围与图素一致；垂直标尺在 displayY 网格上取样，无需再靠「补 0 刻度」
      this.setWorldBounds(imgW, imgH)

      // 4. 精灵左上 (0,0)：世界高=图高时，图底边即 worldY=worldHeight，对应显示 Y=0
      const sprite = new Sprite(texture)
      sprite.position.set(0, 0)

      // 5. 添加到容器
      this.backgroundContainer.addChild(sprite)

      // 6. 保存当前 blob URL
      if (url.startsWith('blob:')) {
        this.currentBlobUrl = url
      } else {
        this.currentBlobUrl = null
      }


      // 7. 等待下一帧，确保 sprite 已经完全渲染
      await new Promise(resolve => requestAnimationFrame(resolve))

      // 8. 与工具栏「适应全图」一致：标尺内居中（避免仅用 alignViewportToRulerOrigin 导致靠左）
      this.fitToWorld(10)
    } catch (error) {
      console.error('Failed to set background image:', error)
      throw error
    }
  }

  /** 清除背景图 */
  public clearBackground(): void {
    if (this.backgroundContainer) {
      this.backgroundContainer.removeChildren().forEach(child => child.destroy())
    }

    // 释放 blob URL
    if (this.currentBlobUrl && this.currentBlobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(this.currentBlobUrl)
      console.log('Revoked blob URL on clear:', this.currentBlobUrl)
      this.currentBlobUrl = null
    }
  }

  /** 销毁编辑器 */
  destroy(): void {
    // 卸载所有插件
    for (const plugin of this.plugins) {
      plugin.uninstall()
    }
    this.plugins = []

    // 清除防抖定时器
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer)
      this.resizeDebounceTimer = null
    }

    // 停止监听尺寸变化
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    // 销毁 viewport
    if (this.viewport) {
      this.viewport.destroy()
      this.viewport = null
    }

    // 销毁 overlay
    if (this.overlayContainer) {
      this.overlayContainer.destroy()
      this.overlayContainer = null
    }

    // 销毁 Pixi Application
    if (this.app) {
      this.app.destroy(true, { children: true })
      this.app = null
    }

    // 清空容器
    if (this.container) {
      this.container.innerHTML = ''
      this.container = null
    }

    this._initialized = false
    this._screenSizeForResize = null
  }

  /**
   * 将视口对齐为：绘图区左下角（世界 x=0、世界 y=worldHeight）落在标尺与画布交界处，
   * 使标尺左下角 X 与 Y 读数均为 0（与 RulerPlugin 的 worldHeight - worldY 一致）。
   * 在 setWorldBounds / 缩放之后调用，或在布局加载后替代 moveCenter。
   */
  public alignViewportToRulerOrigin(): this {
    if (!this.viewport || !this.app) return this
    const scale = this.viewport.scale.x
    const sh = this.app.screen.height
    const wh = this.options.worldHeight
    this.viewport.position.set(
      RULER_THICKNESS,
      (sh - RULER_THICKNESS) - wh * scale
    )
    this.viewport.plugins.reset()
    this._resizeUsesCenteredUnderflowRule = false
    this._screenSizeForResize = {
      w: this.app.screen.width,
      h: this.app.screen.height
    }
    return this
  }

  /** 处理容器尺寸变化 */
  private handleResize(width: number, height: number): void {
    if (!this.app || !this.viewport) return

    this.app.renderer.resize(width, height)
    this.viewport.resize(width, height)

    if (this._screenSizeForResize) {
      const dw = width - this._screenSizeForResize.w
      const dh = height - this._screenSizeForResize.h
      const vp = this.viewport
      if (this._resizeUsesCenteredUnderflowRule) {
        const swPx = vp.worldWidth * vp.scale.x
        const shPx = vp.worldHeight * vp.scale.y
        const ow = this._screenSizeForResize.w
        const oh = this._screenSizeForResize.h
        if (swPx < ow) vp.x += dw / 2
        else vp.x += dw
        if (shPx < oh) vp.y += dh / 2
        else vp.y += dh
      } else {
        vp.x += dw
        vp.y += dh
      }
    } else {
      this.alignViewportToRulerOrigin()
    }
    this._screenSizeForResize = { w: width, h: height }

    // 通知插件
    for (const plugin of this.plugins) {
      plugin.onResize?.(width, height)
    }

    this.notifyViewportChange()
  }

  /** 通知插件 viewport 变化 */
  private notifyViewportChange(): void {
    const transform = this.getTransform()
    // 通知插件
    for (const plugin of this.plugins) {
      plugin.onViewportChange?.(transform)
    }
    // 通知外部监听者 (UI)
    for (const cb of this.transformListeners) {
      cb(transform)
    }
  }

  /** 通知插件主题变化 */
  private notifyThemeChange(): void {
    for (const plugin of this.plugins) {
      plugin.onThemeChange?.(this._theme)
    }
  }

}

