type ElectronAppLike = {
  commandLine: {
    appendSwitch: (name: string, value?: string) => void
  }
  disableHardwareAcceleration: () => void
}

type ConfigureGpuModeOptions = {
  app: ElectronAppLike
  env: NodeJS.ProcessEnv
  hostProductName: string
  hostVendor: string
  isPackaged: boolean
  platform: NodeJS.Platform
}

function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

function isVirtualizedHost(hostProductName: string, hostVendor: string): boolean {
  const fingerprint = `${hostVendor} ${hostProductName}`.toLowerCase()
  return /(vmware|virtualbox|virtual platform|virtual machine|qemu|kvm|hyper-v|hyperv|parallels)/.test(
    fingerprint,
  )
}

function shouldUseSoftwareGpu(options: Omit<ConfigureGpuModeOptions, 'app'>): boolean {
  if (isEnabled(options.env.ECOS_ELECTRON_ENABLE_GPU)) {
    return false
  }

  if (isEnabled(options.env.ECOS_ELECTRON_DISABLE_GPU)) {
    return true
  }

  if (options.platform !== 'linux' || !options.isPackaged) {
    return false
  }

  return isVirtualizedHost(options.hostProductName, options.hostVendor)
}

export function configureGpuMode(options: ConfigureGpuModeOptions): void {
  if (!shouldUseSoftwareGpu(options)) {
    return
  }

  options.app.commandLine.appendSwitch('disable-gpu')
  options.app.commandLine.appendSwitch('disable-gpu-compositing')
  options.app.commandLine.appendSwitch('disable-gpu-process-crash-limit')
  options.app.commandLine.appendSwitch('in-process-gpu')
  options.app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  options.app.commandLine.appendSwitch('use-angle', 'swiftshader')
  options.app.commandLine.appendSwitch('use-gl', 'swiftshader')
  options.env.LIBGL_ALWAYS_SOFTWARE ??= '1'
  options.app.disableHardwareAcceleration()
}
