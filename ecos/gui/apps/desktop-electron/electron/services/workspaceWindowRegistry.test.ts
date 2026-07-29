import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceWindowRegistry,
  normalizeWorkspacePath,
} from './workspaceWindowRegistry'

function createWindowDouble(
  overrides: Partial<{
    destroyed: boolean
    minimized: boolean
  }> = {},
) {
  const state = {
    destroyed: overrides.destroyed ?? false,
    minimized: overrides.minimized ?? false,
  }
  return {
    focus: vi.fn(),
    isDestroyed: () => state.destroyed,
    isMinimized: () => state.minimized,
    restore: vi.fn(() => {
      state.minimized = false
    }),
    show: vi.fn(),
    destroy() {
      state.destroyed = true
    },
    minimize() {
      state.minimized = true
    },
  }
}

describe('normalizeWorkspacePath', () => {
  it('normalizes trailing slashes and backslashes', () => {
    expect(normalizeWorkspacePath(' /work/demo/ ')).toBe('/work/demo')
    expect(normalizeWorkspacePath('C:\\work\\demo\\')).toBe('C:/work/demo')
  })

  it('keeps root slash', () => {
    expect(normalizeWorkspacePath('/')).toBe('/')
  })

  it('trims empty-like input to empty', () => {
    expect(normalizeWorkspacePath('   ')).toBe('')
  })
})

describe('WorkspaceWindowRegistry', () => {
  it('registers and finds windows by normalized path', () => {
    const registry = new WorkspaceWindowRegistry()
    const window = createWindowDouble()

    expect(registry.register('/work/demo/', window)).toBe('/work/demo')
    expect(registry.findWindow('/work/demo')).toBe(window)
    expect(registry.findWindow('/work/demo/')).toBe(window)
    expect(registry.getPathForWindow(window)).toBe('/work/demo')
  })

  it('rejects empty paths and destroyed windows', () => {
    const registry = new WorkspaceWindowRegistry()
    const destroyed = createWindowDouble({ destroyed: true })

    expect(() => registry.register('  ', createWindowDouble())).toThrow('empty')
    expect(() => registry.register('/work/demo', destroyed)).toThrow('destroyed')
  })

  it('moves a path to a new window and clears the previous owner', () => {
    const registry = new WorkspaceWindowRegistry()
    const first = createWindowDouble()
    const second = createWindowDouble()

    registry.register('/work/demo', first)
    registry.register('/work/demo', second)

    expect(registry.findWindow('/work/demo')).toBe(second)
    expect(registry.getPathForWindow(first)).toBeNull()
    expect(registry.getPathForWindow(second)).toBe('/work/demo')
  })

  it('unbinds the previous path when a window registers a different path', () => {
    const registry = new WorkspaceWindowRegistry()
    const window = createWindowDouble()

    registry.register('/work/a', window)
    registry.register('/work/b', window)

    expect(registry.findWindow('/work/a')).toBeNull()
    expect(registry.findWindow('/work/b')).toBe(window)
  })

  it('unregisters by path and by window', () => {
    const registry = new WorkspaceWindowRegistry()
    const first = createWindowDouble()
    const second = createWindowDouble()

    registry.register('/work/a', first)
    registry.register('/work/b', second)

    registry.unregisterByPath('/work/a/')
    expect(registry.findWindow('/work/a')).toBeNull()

    registry.unregisterByWindow(second)
    expect(registry.findWindow('/work/b')).toBeNull()
  })

  it('drops destroyed windows from lookups', () => {
    const registry = new WorkspaceWindowRegistry()
    const window = createWindowDouble()
    registry.register('/work/demo', window)
    window.destroy()

    expect(registry.findWindow('/work/demo')).toBeNull()
    expect(registry.getPathForWindow(window)).toBeNull()
  })

  it('restores minimized windows before focusing', () => {
    const registry = new WorkspaceWindowRegistry()
    const window = createWindowDouble({ minimized: true })
    registry.register('/work/demo', window)

    expect(registry.focusWindow(window)).toBe(true)
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('refuses to focus destroyed windows', () => {
    const registry = new WorkspaceWindowRegistry()
    const window = createWindowDouble({ destroyed: true })

    expect(registry.focusWindow(window)).toBe(false)
    expect(window.focus).not.toHaveBeenCalled()
  })

  it('focusIfBound focuses a bound window and returns false when unbound', () => {
    const registry = new WorkspaceWindowRegistry()
    const window = createWindowDouble()
    registry.register('/work/demo/', window)

    expect(registry.focusIfBound('/work/demo')).toBe(true)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(registry.focusIfBound('/work/missing')).toBe(false)
  })
})
