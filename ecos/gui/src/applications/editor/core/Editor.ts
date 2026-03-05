import { Application, Container, Sprite, Assets, Texture } from 'pixi.js'
import { Viewport } from 'pixi-viewport'
import type { IPlugin, ViewportTransform } from '../plugins/IPlugin'
import { themes, darkTheme, type EditorTheme, type ThemeName } from './Theme'

export interface EditorOptions {
  /** 世界宽度 (默认 4000) */
  worldWidth?: number
  /** 世界高度 (默认 4000) */
  worldHeight?: number
  /** 主题名称 (默认 'dark') */
  theme?: ThemeName
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
      .clampZoom({ minScale: 0.1, maxScale: 10 })

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

    const screenW = this.app?.screen.width ?? 800
    const screenH = this.app?.screen.height ?? 600
    const fitScale = Math.min(screenW / worldWidth, screenH / worldHeight)
    const minScale = fitScale * 0.5
    this.viewport.clampZoom({ minScale, maxScale: 100 })

    return this
  }

  /** 适应所有元素/世界范围 */
  public fitToWorld(padding = 40): this {
    if (!this.viewport || !this.app) return this

    const sw = this.app.screen.width - padding * 2
    const sh = this.app.screen.height - padding * 2

    const scale = Math.min(
      sw / this.options.worldWidth,
      sh / this.options.worldHeight
    )

    this.viewport.setZoom(scale, true)
    this.viewport.moveCenter(
      this.options.worldWidth / 2,
      this.options.worldHeight / 2
    )

    this.notifyViewportChange()
    return this
  }

  /** 
   * 适应当前背景图片，使其在编辑器中居中显示
   * @param padding 四周留白（像素）
   */
  public fit(padding = 10): this {
    if (!this.viewport || !this.app || !this.backgroundContainer) return this

    // 获取背景容器中的第一个子元素（背景图片 Sprite）
    const backgroundSprite = this.backgroundContainer.children[0] as Sprite
    if (!backgroundSprite) {
      console.warn('No background image to fit')
      return this
    }

    // 获取图片的原始尺寸（从纹理获取，不受transform影响）
    const texture = backgroundSprite.texture
    const imgWidth = texture.width
    const imgHeight = texture.height

    if (imgWidth === 0 || imgHeight === 0) {
      console.warn('Background image has zero dimensions')
      return this
    }

    // 获取屏幕尺寸（减去边距）
    const screenWidth = this.app.screen.width - padding * 2
    const screenHeight = this.app.screen.height - padding * 2

    // 计算缩放比例：选择能完整显示图片的最大缩放比例
    const scale = Math.min(
      screenWidth / imgWidth,
      screenHeight / imgHeight
    )

    console.log('Fitting image:', {
      imageSize: { width: imgWidth, height: imgHeight },
      screenSize: {
        width: this.app.screen.width,
        height: this.app.screen.height,
        withPadding: { width: screenWidth, height: screenHeight }
      },
      padding,
      calculatedScale: scale,
      currentScale: this.viewport.scale.x
    })

    // 重置视图位置和缩放
    this.viewport.scale.set(scale)
    this.viewport.position.set(0, 0)

    // 将视图中心移动到图片中心
    this.viewport.moveCenter(imgWidth / 2, imgHeight / 2)

    console.log('After fit:', {
      viewportScale: this.viewport.scale.x,
      viewportPosition: { x: this.viewport.x, y: this.viewport.y },
      viewportCenter: this.viewport.center
    })

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
        console.log('Created texture from blob URL:', texture);
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
        console.log('Loaded texture from asset URL:', texture);
      }

      // 4. 创建 sprite
      const sprite = new Sprite(texture)
      sprite.position.set(0, 0) // 设置位置为原点
      console.log('Created sprite, size:', sprite.width, 'x', sprite.height);

      // 5. 添加到容器
      this.backgroundContainer.addChild(sprite)

      // 6. 保存当前 blob URL
      if (url.startsWith('blob:')) {
        this.currentBlobUrl = url
      } else {
        this.currentBlobUrl = null
      }

      console.log('Background image updated successfully')

      // 7. 等待下一帧，确保 sprite 已经完全渲染
      await new Promise(resolve => requestAnimationFrame(resolve))

      // 8. 自动适应图片尺寸，使其居中显示
      this.fit()
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
  }

  /** 处理容器尺寸变化 */
  private handleResize(width: number, height: number): void {
    if (!this.app || !this.viewport) return

    this.app.renderer.resize(width, height)
    this.viewport.resize(width, height)

    // 通知插件
    for (const plugin of this.plugins) {
      plugin.onResize?.(width, height)
    }
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

