import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  FakeChildProcess,
  access,
  createHash,
  createServer,
  electronApp,
  portAvailabilityQueue,
  socketConnectQueue,
  spawn,
} = vi.hoisted(() => {
  class FakeChildProcess {
    private listeners = new Map<string, (...args: unknown[]) => void>()
    pid: number | undefined
    exitCode: number | null = null
    signalCode: NodeJS.Signals | null = null
    kill = vi.fn((signal?: NodeJS.Signals) => {
      this.signalCode = signal ?? 'SIGTERM'
      return true
    })

    constructor(pid?: number) {
      this.pid = pid
    }

    once(eventName: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(eventName, listener)
      return this
    }

    emit(eventName: string, ...args: unknown[]) {
      this.listeners.get(eventName)?.(...args)
      return true
    }
  }

  const portAvailabilityQueue: boolean[] = []
  const socketConnectQueue: boolean[] = []
  const access = vi.fn()
  const spawn = vi.fn()
  const electronApp = {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/ecos-user-data'),
    getVersion: vi.fn(() => '0.1.0-alpha.4'),
  }
  const createHash = vi.fn(() => {
    const hash = {
      digest: vi.fn(() => 'deterministic-token'),
      update: vi.fn(() => hash),
    }

    return hash
  })
  const createServer = vi.fn(() => {
    let errorListener: ((error: Error) => void) | undefined
    let listeningListener: (() => void) | undefined

    const fakeServer = {
      close: (callback?: () => void) => {
        callback?.()
      },
      listen: () => {
        const isAvailable = portAvailabilityQueue.shift() ?? true

        if (isAvailable) {
          listeningListener?.()
          return
        }

        errorListener?.(new Error('EADDRINUSE'))
      },
      once: (eventName: string, listener: (...args: unknown[]) => void) => {
        if (eventName === 'error') {
          errorListener = listener as (error: Error) => void
        }
        if (eventName === 'listening') {
          listeningListener = listener as () => void
        }

        return fakeServer
      },
    }

    return fakeServer
  })

  return {
    FakeChildProcess,
    access,
    createHash,
    createServer,
    electronApp,
    portAvailabilityQueue,
    socketConnectQueue,
    spawn,
  }
})

vi.mock('electron', () => ({
  app: electronApp,
}))

vi.mock('node:fs/promises', () => ({
  access,
}))

vi.mock('node:child_process', () => ({
  spawn,
}))

vi.mock('node:crypto', () => ({
  createHash,
}))

vi.mock('node:net', () => ({
  Socket: class FakeSocket {
    private listeners: Record<string, ((...args: unknown[]) => void) | undefined> = {}

    setTimeout() {
      return this
    }

    once(eventName: string, listener: (...args: unknown[]) => void) {
      this.listeners[eventName] = listener
      return this
    }

    connect() {
      const shouldConnect = socketConnectQueue.shift() ?? false

      if (shouldConnect) {
        this.listeners.connect?.()
      } else {
        this.listeners.error?.(new Error('ECONNREFUSED'))
      }

      return this
    }

    removeAllListeners() {
      this.listeners = {}
      return this
    }

    destroy() {
      return this
    }
  },
  createServer,
}))

import {
  ApiServerService,
  getApiServerLatestLogFile,
  getApiServerLogFile,
  getElectronLatestMainLogFile,
  getElectronMainLogFile,
  getLogSessionId,
} from './apiServerService'

describe('ApiServerService', () => {
  const originalFetch = globalThis.fetch
  const originalReuseFlag = process.env.ECOS_REUSE_API_SERVER
  const originalApiLogLevel = process.env.ECOS_API_LOG_LEVEL
  const originalElectronLogLevel = process.env.ECOS_ELECTRON_LOG_LEVEL
  const originalReadyTimeout = process.env.ECOS_API_READY_TIMEOUT_SECS
  const originalServerDirectory = process.env.ECOS_SERVER_DIRECTORY
  const originalBinariesDirectory = process.env.ECOS_ELECTRON_BINARIES_DIR
  const originalOssCadDirectory = process.env.ECOS_ELECTRON_OSS_CAD_DIR
  let processKillSpy: ReturnType<typeof vi.spyOn>
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    access.mockReset()
    createHash.mockClear()
    createServer.mockClear()
    spawn.mockReset()
    portAvailabilityQueue.splice(0)
    socketConnectQueue.splice(0)
    electronApp.isPackaged = false
    electronApp.getPath.mockReturnValue('/tmp/ecos-user-data')
    electronApp.getVersion.mockReturnValue('0.1.0-alpha.4')
    process.env.ECOS_REUSE_API_SERVER = ''
    delete process.env.ECOS_API_LOG_LEVEL
    delete process.env.ECOS_ELECTRON_LOG_LEVEL
    delete process.env.ECOS_API_READY_TIMEOUT_SECS
    delete process.env.ECOS_SERVER_DIRECTORY
    delete process.env.ECOS_ELECTRON_BINARIES_DIR
    delete process.env.ECOS_ELECTRON_OSS_CAD_DIR
    globalThis.fetch = vi.fn()
    processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch
    }

    if (originalReuseFlag == null) {
      delete process.env.ECOS_REUSE_API_SERVER
    } else {
      process.env.ECOS_REUSE_API_SERVER = originalReuseFlag
    }

    if (originalApiLogLevel == null) {
      delete process.env.ECOS_API_LOG_LEVEL
    } else {
      process.env.ECOS_API_LOG_LEVEL = originalApiLogLevel
    }

    if (originalElectronLogLevel == null) {
      delete process.env.ECOS_ELECTRON_LOG_LEVEL
    } else {
      process.env.ECOS_ELECTRON_LOG_LEVEL = originalElectronLogLevel
    }

    if (originalReadyTimeout == null) {
      delete process.env.ECOS_API_READY_TIMEOUT_SECS
    } else {
      process.env.ECOS_API_READY_TIMEOUT_SECS = originalReadyTimeout
    }

    if (originalServerDirectory == null) {
      delete process.env.ECOS_SERVER_DIRECTORY
    } else {
      process.env.ECOS_SERVER_DIRECTORY = originalServerDirectory
    }

    if (originalBinariesDirectory == null) {
      delete process.env.ECOS_ELECTRON_BINARIES_DIR
    } else {
      process.env.ECOS_ELECTRON_BINARIES_DIR = originalBinariesDirectory
    }

    if (originalOssCadDirectory == null) {
      delete process.env.ECOS_ELECTRON_OSS_CAD_DIR
    } else {
      process.env.ECOS_ELECTRON_OSS_CAD_DIR = originalOssCadDirectory
    }

    processKillSpy.mockRestore()
    consoleInfoSpy.mockRestore()
    vi.useRealTimers()
  })

  it('reuses a healthy external server on 127.0.0.1:8765 only when ECOS_REUSE_API_SERVER=1', async () => {
    process.env.ECOS_REUSE_API_SERVER = '1'
    portAvailabilityQueue.push(false)
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ status: 'ok' }),
      ok: true,
    })

    const service = new ApiServerService()

    await expect(service.start()).resolves.toBeUndefined()
    await expect(service.getPort()).resolves.toBe(8765)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('surfaces startup failures instead of swallowing them', async () => {
    portAvailabilityQueue.push(true, true)
    access.mockRejectedValue(new Error('missing venv'))
    spawn.mockImplementation(() => {
      throw new Error('spawn failed')
    })

    const service = new ApiServerService()

    await expect(service.start()).rejects.toThrow('spawn failed')
    await expect(service.getPort()).rejects.toThrow('spawn failed')
  })

  it('stops an owned child process on shutdown', async () => {
    vi.useFakeTimers()
    portAvailabilityQueue.push(true, true)
    access.mockRejectedValue(new Error('missing venv'))
    socketConnectQueue.push(true)
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({
        instance_token: 'deterministic-token',
        status: 'ok',
      }),
      ok: true,
    })

    const ownedChild = new FakeChildProcess(4321)
    spawn.mockReturnValue(ownedChild)

    const service = new ApiServerService()

    await service.start()

    processKillSpy.mockImplementation((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -4321 && signal === 'SIGTERM') {
        ownedChild.signalCode = 'SIGTERM'
      }

      return true
    })

    const stopPromise = service.stop()
    await vi.advanceTimersByTimeAsync(500)
    await stopPromise

    expect(processKillSpy).toHaveBeenCalledWith(-4321, 'SIGTERM')
  })

  it('keeps Electron API startup logs quiet by default', async () => {
    portAvailabilityQueue.push(true, true)
    access.mockRejectedValue(new Error('missing venv'))
    socketConnectQueue.push(true)
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({
        instance_token: 'deterministic-token',
        status: 'ok',
      }),
      ok: true,
    })

    const ownedChild = new FakeChildProcess(4321)
    spawn.mockReturnValue(ownedChild)

    const service = new ApiServerService()
    await service.start()

    expect(consoleInfoSpy).not.toHaveBeenCalled()
  })

  it('emits Electron API startup logs when ECOS_ELECTRON_LOG_LEVEL enables info', async () => {
    process.env.ECOS_ELECTRON_LOG_LEVEL = 'info'
    portAvailabilityQueue.push(true, true)
    access.mockRejectedValue(new Error('missing venv'))
    socketConnectQueue.push(true)
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({
        instance_token: 'deterministic-token',
        status: 'ok',
      }),
      ok: true,
    })

    const ownedChild = new FakeChildProcess(4321)
    spawn.mockReturnValue(ownedChild)

    const service = new ApiServerService()
    await service.start()

    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[desktop-electron] Starting FastAPI server (dev mode) from python3 on port 8765',
      ),
    )
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[desktop-electron] FastAPI server ready on port 8765 after 1 attempts',
      ),
    )
  })

  it('passes ECOS_API_LOG_LEVEL to the Python API server command', async () => {
    process.env.ECOS_API_LOG_LEVEL = 'info'
    portAvailabilityQueue.push(true, true)
    access.mockRejectedValue(new Error('missing venv'))
    socketConnectQueue.push(true)
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({
        instance_token: 'deterministic-token',
        status: 'ok',
      }),
      ok: true,
    })

    const ownedChild = new FakeChildProcess(4321)
    spawn.mockReturnValue(ownedChild)

    const service = new ApiServerService()
    await service.start()

    expect(spawn).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([
        '--disable-stdio-redirect',
        '--log-file',
        expect.stringMatching(
          /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/api-server\.log$/,
        ),
        '--log-level',
        'info',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          ECOS_API_LOG_LEVEL: 'info',
          ECOS_API_LOG_FILE: expect.stringMatching(
            /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/api-server\.log$/,
          ),
          ECOS_API_LATEST_LOG_FILE: '/tmp/ecos-user-data/logs/api-server.log',
          ECOS_SERVER_INSTANCE_TOKEN: 'deterministic-token',
        }),
      }),
    )
  })

  it('keeps stable latest log paths and per-launch session log paths', () => {
    expect(getLogSessionId()).toMatch(/^\d{8}-\d{6}-\d+$/)
    expect(getElectronLatestMainLogFile()).toBe('/tmp/ecos-user-data/logs/main.log')
    expect(getApiServerLatestLogFile()).toBe('/tmp/ecos-user-data/logs/api-server.log')
    expect(getElectronMainLogFile()).toMatch(
      /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/main\.log$/,
    )
    expect(getApiServerLogFile()).toMatch(
      /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/api-server\.log$/,
    )
  })

  it('returns GUI and backend runtime versions', async () => {
    portAvailabilityQueue.push(true, true)
    access.mockRejectedValue(new Error('missing venv'))
    socketConnectQueue.push(true)
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        json: async () => ({
          instance_token: 'deterministic-token',
          status: 'ok',
        }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({
          server: '0.1.0-alpha.4',
          ecc: '0.1.0a4',
          dreamplace: '0.1.0a2',
        }),
        ok: true,
      })

    const ownedChild = new FakeChildProcess(4321)
    spawn.mockReturnValue(ownedChild)

    const service = new ApiServerService()
    await service.start()

    await expect(service.getVersions()).resolves.toEqual({
      gui: '0.1.0-alpha.4',
      server: '0.1.0-alpha.4',
      ecc: '0.1.0a4',
      dreamplace: '0.1.0a2',
    })
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8765/api/about',
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('prefers configured binary and resource directories for packaged launches', async () => {
    electronApp.isPackaged = true
    portAvailabilityQueue.push(true, true)
    socketConnectQueue.push(true)
    process.env.ECOS_ELECTRON_BINARIES_DIR = '/opt/ecos/resources/binaries'
    process.env.ECOS_ELECTRON_OSS_CAD_DIR = '/opt/ecos/resources/oss-cad-suite'

    access.mockImplementation(async (path: string) => {
      if (path === '/opt/ecos/resources/binaries/api-server-x86_64-unknown-linux-gnu') {
        return
      }
      if (path === '/opt/ecos/resources/oss-cad-suite') {
        return
      }
      throw new Error(`missing: ${path}`)
    })

    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({
        instance_token: 'deterministic-token',
        status: 'ok',
      }),
      ok: true,
    })

    const ownedChild = new FakeChildProcess(4321)
    spawn.mockReturnValue(ownedChild)

    const service = new ApiServerService()
    await service.start()

    expect(spawn).toHaveBeenCalledWith(
      '/opt/ecos/resources/binaries/api-server-x86_64-unknown-linux-gnu',
      [
        '--host',
        '127.0.0.1',
        '--port',
        '8765',
        '--disable-stdio-redirect',
        '--log-file',
        expect.stringMatching(
          /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/api-server\.log$/,
        ),
        '--log-level',
        'warning',
      ],
      expect.objectContaining({
        cwd: '/opt/ecos/resources/binaries',
        env: expect.objectContaining({
          CHIPCOMPILER_OSS_CAD_DIR: '/opt/ecos/resources/oss-cad-suite',
          ECOS_API_LOG_FILE: expect.stringMatching(
            /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/api-server\.log$/,
          ),
          ECOS_API_LATEST_LOG_FILE: '/tmp/ecos-user-data/logs/api-server.log',
          ECOS_SERVER_INSTANCE_TOKEN: 'deterministic-token',
        }),
      }),
    )
  })

  it('launches a packaged onedir server bundle when binaries path points to a directory', async () => {
    electronApp.isPackaged = true
    portAvailabilityQueue.push(true, true)
    socketConnectQueue.push(true)
    process.env.ECOS_ELECTRON_BINARIES_DIR = '/opt/ecos/resources/binaries'
    process.env.ECOS_ELECTRON_OSS_CAD_DIR = '/opt/ecos/resources/oss-cad-suite'

    access.mockImplementation(async (path: string) => {
      if (path === '/opt/ecos/resources/binaries/api-server-x86_64-unknown-linux-gnu') {
        return
      }
      if (path === '/opt/ecos/resources/binaries/api-server-x86_64-unknown-linux-gnu/ecos-server') {
        return
      }
      if (path === '/opt/ecos/resources/oss-cad-suite') {
        return
      }
      throw new Error(`missing: ${path}`)
    })

    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({
        instance_token: 'deterministic-token',
        status: 'ok',
      }),
      ok: true,
    })

    const ownedChild = new FakeChildProcess(4321)
    spawn.mockReturnValue(ownedChild)

    const service = new ApiServerService()
    await service.start()

    expect(spawn).toHaveBeenCalledWith(
      '/opt/ecos/resources/binaries/api-server-x86_64-unknown-linux-gnu/ecos-server',
      [
        '--host',
        '127.0.0.1',
        '--port',
        '8765',
        '--disable-stdio-redirect',
        '--log-file',
        expect.stringMatching(
          /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/api-server\.log$/,
        ),
        '--log-level',
        'warning',
      ],
      expect.objectContaining({
        cwd: '/opt/ecos/resources/binaries/api-server-x86_64-unknown-linux-gnu',
        env: expect.objectContaining({
          CHIPCOMPILER_OSS_CAD_DIR: '/opt/ecos/resources/oss-cad-suite',
          ECOS_API_LOG_FILE: expect.stringMatching(
            /^\/tmp\/ecos-user-data\/logs\/sessions\/\d{8}-\d{6}-\d+\/api-server\.log$/,
          ),
          ECOS_API_LATEST_LOG_FILE: '/tmp/ecos-user-data/logs/api-server.log',
          ECOS_SERVER_INSTANCE_TOKEN: 'deterministic-token',
        }),
      }),
    )
  })
})
