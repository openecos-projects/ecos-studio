type ElectronAppLike = {
  commandLine: {
    appendSwitch: (name: string, value?: string) => void
  }
}

type ConfigureChromiumLoggingOptions = {
  app: ElectronAppLike
  env: NodeJS.ProcessEnv
}

const DEFAULT_CHROMIUM_LOG_LEVEL = '3'
const VALID_CHROMIUM_LOG_LEVELS = new Set(['0', '1', '2', '3'])

function readChromiumLogLevel(env: NodeJS.ProcessEnv): string {
  const rawLevel = env.ECOS_ELECTRON_CHROMIUM_LOG_LEVEL?.trim()
  if (rawLevel && VALID_CHROMIUM_LOG_LEVELS.has(rawLevel)) {
    return rawLevel
  }
  return DEFAULT_CHROMIUM_LOG_LEVEL
}

export function configureChromiumLogging(options: ConfigureChromiumLoggingOptions): void {
  options.app.commandLine.appendSwitch('log-level', readChromiumLogLevel(options.env))
}
