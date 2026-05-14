import RBush from 'rbush'
import type { LayoutBox, Rect } from './types'

interface IndexItem {
  minX: number
  minY: number
  maxX: number
  maxY: number
  box: LayoutBox
}

export class SpatialIndex {
  private _tree = new RBush<IndexItem>()
  private _built = false

  get built(): boolean {
    return this._built
  }

  buildFromBoxes(boxes: readonly LayoutBox[]): void {
    const items: IndexItem[] = new Array(boxes.length)

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      const r = box.rect
      items[i] = {
        minX: r.x,
        minY: r.y,
        maxX: r.x + r.width,
        maxY: r.y + r.height,
        box,
      }
    }

    this._tree.clear()
    this._tree.load(items)
    this._built = true
  }

  /** Find all boxes that contain the given point */
  queryPoint(x: number, y: number): LayoutBox[] {
    const hits = this._tree.search({ minX: x, minY: y, maxX: x, maxY: y })
    return hits.map((h) => h.box)
  }

  /** Find all boxes that intersect the given rectangle */
  queryRect(rect: Rect): LayoutBox[] {
    const hits = this._tree.search({
      minX: rect.x,
      minY: rect.y,
      maxX: rect.x + rect.width,
      maxY: rect.y + rect.height,
    })
    return hits.map((h) => h.box)
  }

  /** Find all boxes fully contained within the given rectangle */
  queryContained(rect: Rect): LayoutBox[] {
    const hits = this.queryRect(rect)
    const rx1 = rect.x
    const ry1 = rect.y
    const rx2 = rect.x + rect.width
    const ry2 = rect.y + rect.height

    return hits.filter((box) => {
      const r = box.rect
      return r.x >= rx1 && r.y >= ry1 && r.x + r.width <= rx2 && r.y + r.height <= ry2
    })
  }

  clear(): void {
    this._tree.clear()
    this._built = false
  }
}
