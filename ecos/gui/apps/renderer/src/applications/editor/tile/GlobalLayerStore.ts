/**
 * GlobalLayerStore
 *
 * 加载 global.bin，解析大跨度形状（电源条、Pin metal 等），
 * 渲染为永久底层图层，不参与 tile LRU 生命周期。
 *
 * global.bin 格式（全部 little-endian）：
 *   [File Header: 12 bytes]
 *     u32 magic      = 0x45434756  ("ECGV")
 *     u16 version    = 1
 *     u16 reserved
 *     u32 shapeCount
 *   [Shape Table, per shape: 24 bytes]
 *     u32 shapeId    u8 layerIdx   u8 type   u16 nameIdx
 *     i32 x  i32 y  i32 w  i32 h
 *   [String Pool]
 *     u32 stringCount
 *     per string: u16 len + utf8 bytes
 */

import { Container, Graphics } from 'pixi.js'
import type { GlobalShape, PreparedLayer } from './manifest'

const MAGIC = 0x45434756 // "ECGV"

export class GlobalLayerStore {
  private buf: ArrayBuffer | null = null
  readonly shapes: GlobalShape[] = []
  readonly names: string[] = []
  readonly container = new Container()

  private resolveReady!: () => void
  readonly ready: Promise<void> = new Promise<void>(r => { this.resolveReady = r })
  private _loaded = false

  get isLoaded(): boolean { return this._loaded }

  /** 支持 HTTP(S) URL，或 Tauri 下已读入的 ArrayBuffer */
  async load(source: string | ArrayBuffer): Promise<void> {
    if (source instanceof ArrayBuffer) {
      this.buf = source
    } else {
      const res = await fetch(source)
      if (!res.ok) throw new Error(`global.bin fetch failed: ${res.status}`)
      this.buf = await res.arrayBuffer()
    }
    this._parse()
    this._loaded = true
    this.resolveReady()
  }

  private _parse(): void {
    const v = new DataView(this.buf!)
    const magic = v.getUint32(0, true)
    if (magic !== MAGIC) throw new Error(`global.bin bad magic: ${magic.toString(16)}`)

    const shapeCount = v.getUint32(8, true)

    // Shape table starts at offset 12, each entry 24 bytes
    const SHAPE_SIZE = 24
    const shapeStart = 12
    for (let i = 0; i < shapeCount; i++) {
      const o = shapeStart + i * SHAPE_SIZE
      this.shapes.push({
        shapeId:  v.getUint32(o, true),
        layerIdx: v.getUint8(o + 4),
        type:     v.getUint8(o + 5),
        nameIdx:  v.getUint16(o + 6, true),
        x:        v.getInt32(o + 8, true),
        y:        v.getInt32(o + 12, true),
        w:        v.getInt32(o + 16, true),
        h:        v.getInt32(o + 20, true),
      })
    }

    // String pool
    let o = shapeStart + shapeCount * SHAPE_SIZE
    if (o + 4 <= v.byteLength) {
      const strCount = v.getUint32(o, true); o += 4
      const decoder = new TextDecoder('utf-8')
      for (let i = 0; i < strCount; i++) {
        const len = v.getUint16(o, true); o += 2
        const bytes = new Uint8Array(this.buf!, o, len)
        this.names.push(decoder.decode(bytes))
        o += len
      }
    }
  }

  /**
   * 渲染 global 形状到 container 中，按 layer zOrder 排序。
   * container 应作为 viewport 的最底层子元素。
   */
  render(preparedLayers: PreparedLayer[]): void {
    this.container.removeChildren()
    if (this.shapes.length === 0) return

    // layerIdx → PreparedLayer lookup
    const layerById = new Map(preparedLayers.map(pl => [pl.id, pl]))

    // 按 layer 分组
    const byLayer = new Map<number, GlobalShape[]>()
    for (const shape of this.shapes) {
      const arr = byLayer.get(shape.layerIdx)
      if (arr) arr.push(shape)
      else byLayer.set(shape.layerIdx, [shape])
    }

    // 按 zOrder 排序后渲染
    const sortedEntries = [...byLayer.entries()].sort((a, b) => {
      const la = layerById.get(a[0])
      const lb = layerById.get(b[0])
      return (la?.id ?? 0) - (lb?.id ?? 0)
    })

    for (const [layerIdx, shapes] of sortedEntries) {
      const pl = layerById.get(layerIdx)
      if (!pl) continue

      const g = new Graphics()
      for (const s of shapes) {
        g.rect(s.x, s.y, s.w, s.h)
      }
      g.fill({ color: pl.color, alpha: pl.alpha })
      g.label = `global-layer-${layerIdx}`
      this.container.addChild(g)
    }
  }

  /** 按 layerIdx 设置该层 global 形状的可见性 */
  setLayerVisible(layerIdx: number, visible: boolean): void {
    for (const child of this.container.children) {
      if (child.label === `global-layer-${layerIdx}`) {
        child.visible = visible
      }
    }
  }

  /** 获取 shape 关联的名称（如 "VDD"、"VSS"） */
  getShapeName(shape: GlobalShape): string | undefined {
    return this.names[shape.nameIdx]
  }

  destroy(): void {
    this.container.removeChildren().forEach(c => c.destroy())
    this.container.destroy()
    this.shapes.length = 0
    this.names.length = 0
    this.buf = null
    this._loaded = false
  }
}
