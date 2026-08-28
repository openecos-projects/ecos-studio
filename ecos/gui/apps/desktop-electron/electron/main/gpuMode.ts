type ElectronAppLike = {
  commandLine: {
    appendSwitch: (name: string, value?: string) => void
  }
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
  const isWsl =
    options.env.WSL_DISTRO_NAME !== undefined || options.env.WSL_INTEROP !== undefined

  if (isWsl && options.platform === 'linux') {
    options.app.commandLine.appendSwitch('disable-features', 'Vulkan,VulkanFromANGLE,DefaultANGLEVulkan')
  }

  if (!shouldUseSoftwareGpu(options) && !isWsl) {
    return
  }

  // Surfer requires WebGL. Force Chromium's bundled CPU renderer without
  // disabling the GPU process, because --disable-gpu also disables WebGL.
  options.app.commandLine.appendSwitch('enable-unsafe-swiftshader')
  options.app.commandLine.appendSwitch('use-angle', 'swiftshader')
  options.app.commandLine.appendSwitch('use-gl', 'angle')
  options.env.LIBGL_ALWAYS_SOFTWARE ??= '1'
}
