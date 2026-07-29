import { normalizeWorkspacePath } from './workspacePath'

export { normalizeWorkspacePath }

export interface WorkspaceWindowLike {
  focus(): void
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
}

export class WorkspaceWindowRegistry {
  private readonly pathToWindow = new Map<string, WorkspaceWindowLike>()
  private readonly windowToPath = new Map<WorkspaceWindowLike, string>()

  register(path: string, window: WorkspaceWindowLike): string {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) {
      throw new Error('Workspace path is empty')
    }
    if (window.isDestroyed()) {
      throw new Error('Cannot register a destroyed window')
    }

    const previousWindow = this.pathToWindow.get(normalized)
    if (previousWindow && previousWindow !== window) {
      this.windowToPath.delete(previousWindow)
    }

    const previousPath = this.windowToPath.get(window)
    if (previousPath && previousPath !== normalized) {
      this.pathToWindow.delete(previousPath)
    }

    this.pathToWindow.set(normalized, window)
    this.windowToPath.set(window, normalized)
    return normalized
  }

  unregisterByPath(path: string): void {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) return
    const window = this.pathToWindow.get(normalized)
    if (!window) return
    this.pathToWindow.delete(normalized)
    this.windowToPath.delete(window)
  }

  unregisterByWindow(window: WorkspaceWindowLike): void {
    const path = this.windowToPath.get(window)
    if (!path) return
    this.windowToPath.delete(window)
    this.pathToWindow.delete(path)
  }

  findWindow(path: string): WorkspaceWindowLike | null {
    const normalized = normalizeWorkspacePath(path)
    if (!normalized) return null
    const window = this.pathToWindow.get(normalized)
    if (!window) return null
    if (window.isDestroyed()) {
      this.unregisterByPath(normalized)
      return null
    }
    return window
  }

  getPathForWindow(window: WorkspaceWindowLike): string | null {
    if (window.isDestroyed()) {
      this.unregisterByWindow(window)
      return null
    }
    return this.windowToPath.get(window) ?? null
  }

  focusWindow(window: WorkspaceWindowLike): boolean {
    if (window.isDestroyed()) {
      this.unregisterByWindow(window)
      return false
    }
    if (window.isMinimized()) {
      window.restore()
    }
    window.show()
    window.focus()
    return true
  }

  /** Focus the window bound to `path`, if any. Returns true when focused. */
  focusIfBound(path: string): boolean {
    const window = this.findWindow(path)
    if (!window) {
      return false
    }
    return this.focusWindow(window)
  }

  clearAll(): void {
    this.pathToWindow.clear()
    this.windowToPath.clear()
  }
}

export const workspaceWindowRegistry = new WorkspaceWindowRegistry()
