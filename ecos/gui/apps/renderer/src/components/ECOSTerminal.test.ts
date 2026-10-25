// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => {
  class FakeTerminal {
    static instances: FakeTerminal[] = []

    readonly element = document.createElement('div')
    readonly cols = 80
    readonly rows = 24
    readonly selectionListeners: Array<() => void> = []
    readonly paste = vi.fn()
    readonly focus = vi.fn()
    readonly dispose = vi.fn()
    selection = ''

    constructor() {
      FakeTerminal.instances.push(this)
    }

    loadAddon() {}

    onData() {
      return { dispose: vi.fn() }
    }

    onSelectionChange(listener: () => void) {
      this.selectionListeners.push(listener)
      return {
        dispose: () => {
          const index = this.selectionListeners.indexOf(listener)
          if (index >= 0) this.selectionListeners.splice(index, 1)
        },
      }
    }

    getSelection() {
      return this.selection
    }

    open(parent: HTMLElement) {
      parent.append(this.element)
    }

    write() {}

    writeln() {}

    scrollToBottom() {}
  }

  return {
    FakeTerminal,
    desktopApi: {
      shell: {
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
        createSession: vi.fn(),
        resize: vi.fn(),
        write: vi.fn(),
        kill: vi.fn(),
      },
    },
  }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: testState.FakeTerminal,
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {},
}))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}))
vi.mock('@/platform/desktop', () => ({
  getDesktopApi: () => testState.desktopApi,
}))

import ECOSTerminal from './ECOSTerminal.vue'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(clipboard: Clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
}

afterEach(() => {
  testState.FakeTerminal.instances.length = 0
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  } else {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
  }
  vi.restoreAllMocks()
})

function mountTerminal() {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })

  return mount(ECOSTerminal, {
    props: {
      expanded: false,
      maximized: false,
      projectPath: null,
      themeName: 'light',
    },
  })
}

describe('ECOSTerminal clipboard behavior', () => {
  it('copies the current selection when xterm reports a selection change', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText, readText: vi.fn() } as unknown as Clipboard)
    const wrapper = mountTerminal()
    await flushPromises()

    const terminal = testState.FakeTerminal.instances[0]
    terminal.selection = 'selected output'
    terminal.selectionListeners[0]?.()
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith('selected output')
    wrapper.unmount()
  })

  it('pastes clipboard text on right click and removes the listener on unmount', async () => {
    const readText = vi.fn().mockResolvedValue('command from clipboard')
    setClipboard({ writeText: vi.fn(), readText } as unknown as Clipboard)
    const wrapper = mountTerminal()
    await flushPromises()

    const terminal = testState.FakeTerminal.instances[0]
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    expect(terminal.element.dispatchEvent(event)).toBe(false)
    await flushPromises()

    expect(readText).toHaveBeenCalledTimes(1)
    expect(terminal.paste).toHaveBeenCalledWith('command from clipboard')
    expect(terminal.focus).toHaveBeenCalled()

    wrapper.unmount()
    terminal.element.dispatchEvent(new MouseEvent('contextmenu'))
    expect(readText).toHaveBeenCalledTimes(1)
  })
})
