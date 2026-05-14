import type { Editor } from '../core/Editor'
import type { IPlugin } from './IPlugin'
import type { LayoutDataStore } from '../layout/LayoutDataStore'
import type { LayoutRenderer } from '../layout/LayoutRenderer'
import { GroupType } from '../layout/types'

export class HighlightPlugin implements IPlugin {
  readonly name = 'highlight'
  private _dataStore: LayoutDataStore | null = null
  private _renderer: LayoutRenderer | null = null
  private _enabled = true
  private _highlightedGroupIndices = new Set<number>()

  configure(dataStore: LayoutDataStore, renderer: LayoutRenderer): void {
    this._dataStore = dataStore
    this._renderer = renderer
  }

  install(_editor: Editor): void {}

  uninstall(): void {
    this.clearHighlights()
    this._dataStore = null
    this._renderer = null
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled
    if (!enabled) this.clearHighlights()
  }

  isEnabled(): boolean {
    return this._enabled
  }

  highlightGroupByName(name: string, color = 0xff00ff): void {
    if (!this._enabled || !this._dataStore || !this._renderer) return

    const group = this._dataStore.getGroupByName(name)
    if (!group || group.children.length === 0) return

    const idx = this._dataStore.getGroupIndexByName(name)
    this._highlightedGroupIndices.add(idx)
    this._renderer.drawHighlight(group.children, color, 0.6)
  }

  highlightGroupsByType(type: GroupType, color = 0xff00ff): void {
    if (!this._enabled || !this._dataStore || !this._renderer) return

    const groups = this._dataStore.getGroupsByType(type)
    for (const group of groups) {
      if (group.children.length > 0) {
        const idx = this._dataStore.getGroupIndexByName(group.structName)
        this._highlightedGroupIndices.add(idx)
        this._renderer.drawHighlight(group.children, color, 0.4)
      }
    }
  }

  clearHighlights(): void {
    this._highlightedGroupIndices.clear()
    this._renderer?.clearOverlay()
  }

  get highlightedCount(): number {
    return this._highlightedGroupIndices.size
  }
}
