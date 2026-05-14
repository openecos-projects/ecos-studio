import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function resolvePreloadPath(): string {
  const candidates = [
    '../preload/index.cjs',
    '../preload/index.js',
    '../preload/index.mjs',
  ]

  for (const relativePath of candidates) {
    const absolutePath = fileURLToPath(new URL(relativePath, import.meta.url))
    if (existsSync(absolutePath)) {
      return absolutePath
    }
  }

  return fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
}

const preloadPath = resolvePreloadPath()
const rendererIndexPath = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
const FORWARD_RENDERER_CONSOLE = process.env.ECOS_FORWARD_RENDERER_CONSOLE === '1'

function shouldOpenDevTools(): boolean {
  return process.env.ECOS_ELECTRON_OPEN_DEVTOOLS === '1'
}

function logRendererConsoleMessage(message: string): void {
  try {
    console.log(message)
  } catch {
    // Ignore stdout/stderr write failures in GUI environments. Renderer logs are
    // helpful during debugging, but should never crash the main process.
  }
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    frame: false,
    // Let the native window itself expose transparent corners; CSS border-radius
    // alone can only round the web contents, not the OS-level window bounds.
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (FORWARD_RENDERER_CONSOLE) {
    mainWindow.webContents.on('console-message', (details) => {
      const levelName =
        details.level === 'warning'
          ? 'warn'
          : details.level
      const source = details.sourceId || 'renderer'
      logRendererConsoleMessage(
        `[renderer:${levelName}] ${source}:${details.lineNumber} ${details.message}`,
      )
    })
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl)
    if (shouldOpenDevTools()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
    return mainWindow
  }

  await mainWindow.loadFile(rendererIndexPath)
  if (shouldOpenDevTools()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  return mainWindow
}
