import { describe, expect, it, vi } from 'vitest'

import { configureChromiumLogging } from './chromiumLogging'

function createAppDouble() {
  return {
    commandLine: {
      appendSwitch: vi.fn(),
    },
  }
}

describe('configureChromiumLogging', () => {
  it('raises Chromium native log threshold to fatal by default', () => {
    const appDouble = createAppDouble()

    configureChromiumLogging({
      app: appDouble,
      env: {},
    })

    expect(appDouble.commandLine.appendSwitch).toHaveBeenCalledWith('log-level', '3')
  })

  it('allows Chromium log level override for local debugging', () => {
    const appDouble = createAppDouble()

    configureChromiumLogging({
      app: appDouble,
      env: {
        ECOS_ELECTRON_CHROMIUM_LOG_LEVEL: '1',
      },
    })

    expect(appDouble.commandLine.appendSwitch).toHaveBeenCalledWith('log-level', '1')
  })

  it('ignores invalid Chromium log level overrides', () => {
    const appDouble = createAppDouble()

    configureChromiumLogging({
      app: appDouble,
      env: {
        ECOS_ELECTRON_CHROMIUM_LOG_LEVEL: 'verbose',
      },
    })

    expect(appDouble.commandLine.appendSwitch).toHaveBeenCalledWith('log-level', '3')
  })
})
