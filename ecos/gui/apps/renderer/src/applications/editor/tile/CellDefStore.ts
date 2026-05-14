/**
 * CellDefStore
 *
 * 加载 cells.bin，提供 getCellDef(cellId) 接口。
 * 使用 SharedArrayBuffer（需服务器开启 COOP/COEP）或普通 ArrayBuffer。
 *
 * cells.bin 格式（全部 little-endian）：
 *   [File Header: 16 bytes]
 *     u32 magic        = 0x4543454C  ("ECEL")
 *     u16 version      = 1
 *     u16 reserved
 *     u32 cellCount
 *     u32 indexOffset  ← Index Table 起始字节偏移
 *
 *   [Cell Index Table]
 *     cellCount × { u32 cellId, u32 offset, u32 byteLen }
 *
 *   [Cell Data, per cell]
 *     u32 cellId
 *     i32 bboxW
 *     i32 bboxH
 *     u8  layerCount
 *     u8  flags  (bit0 = coordBits: 0=i16, 1=i32)
 *     per layer:
 *       u8  layerIdx
 *       u16 rectCount
 *       rectCount × [lx, ly, lw, lh]  (i16×4 or i32×4)
 */

import type { CellDef } from './manifest'

export class CellDefStore {
  private buf: ArrayBuffer | null = null
  // cellId → { offset, byteLen }
  private index = new Map<number, { offset: number; byteLen: number }>()
  // 已解析缓存
  private cache = new Map<number, CellDef>()

  private resolveReady!: () => void
  /** 加载完成后 resolve 的 Promise，供 TileManager 等待 */
  readonly ready: Promise<void> = new Promise<void>(r => { this.resolveReady = r })

  get isLoaded(): boolean {
    return this.buf !== null
  }

  /** 支持 HTTP(S) URL，或 Tauri 下已读入的 ArrayBuffer（避免 asset:// 无法用 fetch） */
  async load(source: string | ArrayBuffer): Promise<void> {
    if (source instanceof ArrayBuffer) {
      this.buf = source
    } else {
      const res = await fetch(source)
      if (!res.ok) throw new Error(`cells.bin fetch failed: ${res.status}`)
      this.buf = await res.arrayBuffer()
    }
    this._buildIndex()
    this.resolveReady()
  }

  private _buildIndex(): void {
    const v = new DataView(this.buf!)
    const magic = v.getUint32(0, true)
    if (magic !== 0x4543454C) throw new Error(`cells.bin bad magic: ${magic.toString(16)}`)

    const cellCount  = v.getUint32(8, true)
    const indexStart = v.getUint32(12, true)

    for (let i = 0; i < cellCount; i++) {
      const o = indexStart + i * 12
      const cellId  = v.getUint32(o,     true)
      const offset  = v.getUint32(o + 4, true)
      const byteLen = v.getUint32(o + 8, true)
      this.index.set(cellId, { offset, byteLen })
    }
  }

  /** 按需解析并缓存 cell 定义，O(1) 后续访问 */
  getCellDef(cellId: number): CellDef | null {
    const cached = this.cache.get(cellId)
    if (cached) return cached

    const entry = this.index.get(cellId)
    if (!entry || !this.buf) return null

    const v = new DataView(this.buf)
    let o = entry.offset

    const id     = v.getUint32(o, true);  o += 4
    const bboxW  = v.getInt32(o, true);   o += 4
    const bboxH  = v.getInt32(o, true);   o += 4
    const lCount = v.getUint8(o);         o += 1
    const flags  = v.getUint8(o);         o += 1
    const use32  = (flags & 1) === 1

    const layers: CellDef['layers'] = []

    for (let li = 0; li < lCount; li++) {
      const layerIdx  = v.getUint8(o);          o += 1
      const rectCount = v.getUint16(o, true);   o += 2

      const rects: { lx: number; ly: number; lw: number; lh: number }[] = []

      for (let ri = 0; ri < rectCount; ri++) {
        let lx: number, ly: number, lw: number, lh: number
        if (use32) {
          lx = v.getInt32(o, true); o += 4
          ly = v.getInt32(o, true); o += 4
          lw = v.getInt32(o, true); o += 4
          lh = v.getInt32(o, true); o += 4
        } else {
          lx = v.getInt16(o, true); o += 2
          ly = v.getInt16(o, true); o += 2
          lw = v.getInt16(o, true); o += 2
          lh = v.getInt16(o, true); o += 2
        }
        rects.push({ lx, ly, lw, lh })
      }

      layers.push({ layerIdx, rects })
    }

    const def: CellDef = {
      cellId: id, bboxW, bboxH, layers,
      layerMap: new Map(layers.map(l => [l.layerIdx, l.rects])),
    }
    this.cache.set(cellId, def)
    return def
  }

  get cellCount(): number {
    return this.index.size
  }

  getAllCellIds(): number[] {
    return [...this.index.keys()]
  }

  destroy(): void {
    this.buf = null
    this.index.clear()
    this.cache.clear()
  }
}
