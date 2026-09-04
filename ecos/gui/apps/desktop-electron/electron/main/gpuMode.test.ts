import { describe, expect, it, vi } from 'vitest'

import { configureGpuMode } from './gpuMode'

function createAppDouble() {
  return {
    commandLine: {
      appendSwitch: vi.fn(),
    },
    disableHardwareAcceleration: vi.fn(),
  }
}

describe('configureGpuMode', () => {
  it('enables the software GPU workaround when explicitly requested', () => {
    const appDouble = createAppDouble()
    const env: NodeJS.ProcessEnv = {
      ECOS_ELECTRON_DISABLE_GPU: '1',
    }

    configureGpuMode({
      app: appDouble,
      env,
      hostProductName: '',
      hostVendor: '',
      isPackaged: false,
      platform: 'linux',
    })

    expect(appDouble.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(appDouble.commandLine.appendSwitch).toHaveBeenCalledWith(
      'enable-unsafe-swiftshader',
    )
    expect(appDouble.commandLine.appendSwitch).toHaveBeenCalledWith(
      'use-angle',
      'swiftshader',
    )
    expect(appDouble.commandLine.appendSwitch).toHaveBeenCalledWith('use-gl', 'angle')
    expect(appDouble.commandLine.appendSwitch).not.toHaveBeenCalledWith('disable-gpu')
    expect(env.LIBGL_ALWAYS_SOFTWARE).toBe('1')
  })

  it('automatically enables the workaround for packaged Linux apps on VMware hosts', () => {
    const appDouble = createAppDouble()
    const env: NodeJS.ProcessEnv = {}

    configureGpuMode({
      app: appDouble,
      env,
      hostProductName: 'VMware Virtual Platform',
      hostVendor: 'VMware, Inc.',
      isPackaged: true,
      platform: 'linux',
    })

    expect(appDouble.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(appDouble.commandLine.appendSwitch).toHaveBeenCalledWith(
      'use-angle',
      'swiftshader',
    )
    expect(appDouble.commandLine.appendSwitch).not.toHaveBeenCalledWith('disable-gpu')
    expect(env.LIBGL_ALWAYS_SOFTWARE).toBe('1')
  })

  it('does not force software rendering on packaged Linux apps for non-virtualized hosts', () => {
    const appDouble = createAppDouble()
    const env: NodeJS.ProcessEnv = {}

    configureGpuMode({
      app: appDouble,
      env,
      hostProductName: 'Precision 5680',
      hostVendor: 'Dell Inc.',
      isPackaged: true,
      platform: 'linux',
    })

    expect(appDouble.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(appDouble.commandLine.appendSwitch).not.toHaveBeenCalled()
    expect(env.LIBGL_ALWAYS_SOFTWARE).toBeUndefined()
  })

  it('allows explicit GPU enablement to override virtualization-based fallback', () => {
    const appDouble = createAppDouble()
    const env: NodeJS.ProcessEnv = {
      ECOS_ELECTRON_ENABLE_GPU: 'true',
    }

    configureGpuMode({
      app: appDouble,
      env,
      hostProductName: 'VMware Virtual Platform',
      hostVendor: 'VMware, Inc.',
      isPackaged: true,
      platform: 'linux',
    })

    expect(appDouble.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(appDouble.commandLine.appendSwitch).not.toHaveBeenCalled()
    expect(env.LIBGL_ALWAYS_SOFTWARE).toBeUndefined()
  })

  it('does not force software rendering on WSL without virtualization flags', () => {
    const appDouble = createAppDouble()
    const env: NodeJS.ProcessEnv = {
      WSL_DISTRO_NAME: 'Ubuntu',
    }

    configureGpuMode({
      app: appDouble,
      env,
      hostProductName: 'Precision 5680',
      hostVendor: 'Dell Inc.',
      isPackaged: true,
      platform: 'linux',
    })

    expect(appDouble.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(appDouble.commandLine.appendSwitch).not.toHaveBeenCalled()
    expect(env.LIBGL_ALWAYS_SOFTWARE).toBeUndefined()
  })
})
