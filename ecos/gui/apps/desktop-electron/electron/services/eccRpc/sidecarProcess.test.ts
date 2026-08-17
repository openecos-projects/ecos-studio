import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EccRpcShutdownDeferredError,
  EccRpcSidecarProcess,
  type SpawnedEccRpcSidecar,
} from './sidecarProcess'
import { encodeContentLengthFrame } from './transport'

class FakeWritable extends Writable {
  readonly chunks: Buffer[] = []

  _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }
}

class FakeChild extends EventEmitter implements SpawnedEccRpcSidecar {
  readonly stderr = new PassThrough()
  readonly stdin = new FakeWritable()
  readonly stdout = new PassThrough()
  readonly signals: Array<NodeJS.Signals | undefined> = []
  killed = false

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal)
    this.killed = true
    return true
  }
}

describe('EccRpcSidecarProcess', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns ECC with persistent DB support for GUI edit sessions', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const sidecar = new EccRpcSidecarProcess({
      env: { PATH: '/bin' },
      spawn,
    })

    await sidecar.start()

    expect(spawn).toHaveBeenCalledWith(
      'ecc',
      ['rpc', 'serve', '--stdio', '--persistent-db'],
      {
        env: { PATH: '/bin' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
  })

  it('spawns the resolved absolute ECC executable when provided', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const sidecar = new EccRpcSidecarProcess({
      command: '/tmp/packaged/binaries/ecc',
      env: { PATH: '/home/ecos/.local/bin:/bin' },
      spawn,
    })

    await sidecar.start()

    expect(spawn).toHaveBeenCalledWith(
      '/tmp/packaged/binaries/ecc',
      ['rpc', 'serve', '--stdio', '--persistent-db'],
      {
        env: { PATH: '/home/ecos/.local/bin:/bin' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
  })

  it('rechecks equivalent runtime environments before reusing the sidecar', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const envProvider = vi
      .fn<() => Promise<NodeJS.ProcessEnv>>()
      .mockResolvedValueOnce({ PATH: '/bin', TOOL_ROOT: '/tools' })
      .mockResolvedValueOnce({ TOOL_ROOT: '/tools', PATH: '/bin' })
    const sidecar = new EccRpcSidecarProcess({ envProvider, spawn })

    const firstClient = await sidecar.start()
    const secondClient = await sidecar.start()

    expect(secondClient).toBe(firstClient)
    expect(envProvider).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('restarts the sidecar before using a changed runtime environment', async () => {
    const firstChild = new FakeChild()
    const secondChild = new FakeChild()
    const children = [firstChild, secondChild]
    const spawn = vi.fn(() => children.shift()!)
    let runtimeEnv: NodeJS.ProcessEnv = { PATH: '/tools/v1/bin' }
    const sidecar = new EccRpcSidecarProcess({
      envProvider: async () => runtimeEnv,
      spawn,
    })
    const firstClient = await sidecar.start()
    runtimeEnv = { PATH: '/tools/v2/bin' }

    const restart = sidecar.start()
    await vi.waitFor(() => {
      expect(firstChild.stdin.chunks).toHaveLength(1)
    })
    firstChild.stdout.write(
      encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
    )
    firstChild.emit('close', 0, null)

    const secondClient = await restart

    expect(secondClient).not.toBe(firstClient)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenLastCalledWith(
      'ecc',
      ['rpc', 'serve', '--stdio', '--persistent-db'],
      {
        env: { PATH: '/tools/v2/bin' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
  })

  it('reuses the last successful environment when the provider temporarily fails', async () => {
    const firstChild = new FakeChild()
    const secondChild = new FakeChild()
    const children = [firstChild, secondChild]
    const spawn = vi.fn(() => children.shift()!)
    const envProvider = vi
      .fn<() => Promise<NodeJS.ProcessEnv>>()
      .mockResolvedValueOnce({ PATH: '/tools/bin' })
      .mockRejectedValueOnce(new Error('manifest unavailable'))
    const sidecar = new EccRpcSidecarProcess({
      env: { PATH: '/base/bin' },
      envProvider,
      spawn,
    })
    const firstClient = await sidecar.start()
    let secondClient: unknown
    let settled = false

    const secondStart = sidecar.start().then((client) => {
      secondClient = client
      settled = true
      return client
    })
    await new Promise((resolve) => setImmediate(resolve))
    const reusedHealthyClient = settled && secondClient === firstClient

    if (!settled) {
      firstChild.stdout.write(
        encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
      )
      firstChild.emit('close', 0, null)
      await secondStart
    }

    expect(reusedHealthyClient).toBe(true)
    expect(envProvider).toHaveBeenCalledTimes(2)
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('bounds restart when shutdown responds but the child never exits', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    let runtimeEnv: NodeJS.ProcessEnv = { PATH: '/tools/v1/bin' }
    const sidecar = new EccRpcSidecarProcess({
      envProvider: async () => runtimeEnv,
      shutdownTimeoutMs: 25,
      spawn,
    })
    await sidecar.start()
    runtimeEnv = { PATH: '/tools/v2/bin' }

    const restartError = sidecar.start().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)
    expect(child.stdin.chunks).toHaveLength(1)
    child.stdout.write(
      encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
    )
    await vi.advanceTimersByTimeAsync(25)
    expect(child.signals).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    await vi.advanceTimersByTimeAsync(25)

    await expect(restartError).resolves.toMatchObject({
      message: 'ECC RPC sidecar did not exit after SIGKILL.',
    })
    expect(spawn).toHaveBeenCalledOnce()
  })

  it('uses one bounded signal escalation when restart shutdown times out', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    let runtimeEnv: NodeJS.ProcessEnv = { PATH: '/tools/v1/bin' }
    const sidecar = new EccRpcSidecarProcess({
      envProvider: async () => runtimeEnv,
      shutdownTimeoutMs: 25,
      spawn: () => child,
    })
    await sidecar.start()
    runtimeEnv = { PATH: '/tools/v2/bin' }

    const restartError = sidecar.start().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(25)
    expect(child.signals).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    await vi.advanceTimersByTimeAsync(25)

    await expect(restartError).resolves.toMatchObject({
      message: 'ECC RPC sidecar did not exit after SIGKILL.',
    })
    expect(child.listenerCount('close')).toBe(1)
  })

  it('connects stdout responses to the JSON-RPC client', async () => {
    const child = new FakeChild()
    const sidecar = new EccRpcSidecarProcess({ spawn: () => child })
    const client = await sidecar.start()

    const promise = client.call<{ ok: boolean }>('rpc.ping')
    child.stdout.write(
      encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
    )

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('recovers a response after malformed tool output leaks to stdout', async () => {
    const child = new FakeChild()
    const events: unknown[] = []
    const sidecar = new EccRpcSidecarProcess({
      onEvent: (event) => events.push(event),
      spawn: () => child,
    })
    const client = await sidecar.start()

    const promise = client.call<{ ok: boolean }>('rpc.ping')
    child.stdout.write(
      Buffer.concat([
        Buffer.from('tool output before protocol frame\r\n\r\n'),
        encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
      ]),
    )

    await expect(promise).resolves.toEqual({ ok: true })
    expect(events).toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('discarded malformed stdout'),
        type: 'runtime.stderr',
      }),
    )
  })

  it('does not signal a sidecar when ECC defers shutdown for an active operation', async () => {
    const child = new FakeChild()
    const sidecar = new EccRpcSidecarProcess({ spawn: () => child })
    await sidecar.start()

    const shutdown = sidecar.shutdown()
    await vi.waitFor(() => {
      expect(child.stdin.chunks).toHaveLength(1)
    })
    child.stdout.write(
      encodeContentLengthFrame(
        '{"jsonrpc":"2.0","id":1,"result":{"ok":false,"deferred":true,"shutdownBarrier":{"operationId":"operation-1"}}}',
      ),
    )

    await expect(shutdown).rejects.toBeInstanceOf(EccRpcShutdownDeferredError)
    expect(child.signals).toEqual([])
  })

  it('waits for the sidecar process to exit after rpc.shutdown is acknowledged', async () => {
    const child = new FakeChild()
    const sidecar = new EccRpcSidecarProcess({ spawn: () => child })
    await sidecar.start()

    let settled = false
    const shutdown = sidecar.shutdown().then(() => {
      settled = true
    })
    await vi.waitFor(() => {
      expect(child.stdin.chunks).toHaveLength(1)
    })
    child.stdout.write(
      encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
    )
    await new Promise((resolve) => setImmediate(resolve))

    expect(settled).toBe(false)
    child.emit('close', 0, null)
    await expect(shutdown).resolves.toBeUndefined()
  })

  it('forwards sidecar JSON-RPC notifications to the runtime owner', async () => {
    const child = new FakeChild()
    const notifications: unknown[] = []
    const sidecar = new EccRpcSidecarProcess({
      onNotification: (notification) => notifications.push(notification),
      spawn: () => child,
    })

    await sidecar.start()
    child.stdout.write(
      encodeContentLengthFrame(
        '{"jsonrpc":"2.0","method":"runtime.event","params":{"eventId":"workspace-1:1"}}',
      ),
    )

    expect(notifications).toEqual([
      {
        jsonrpc: '2.0',
        method: 'runtime.event',
        params: { eventId: 'workspace-1:1' },
      },
    ])
  })

  it('writes stderr to a runtime log file and emits stderr events', async () => {
    const child = new FakeChild()
    const tempDir = mkdtempSync(join(tmpdir(), 'ecc-rpc-sidecar-'))
    const events: unknown[] = []
    const sidecar = new EccRpcSidecarProcess({
      onEvent: (event) => events.push(event),
      spawn: () => child,
      tempDir,
    })

    await sidecar.start()
    child.stderr.write('hello stderr\n')

    const logFile = sidecar.logFile
    expect(logFile).toBeTruthy()
    expect(readFileSync(logFile!, 'utf8')).toContain('hello stderr')
    expect(events).toContainEqual({
      logFile,
      text: 'hello stderr\n',
      type: 'runtime.stderr',
    })
  })

  it('gives concurrent sidecars separate logs in one desktop session directory', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ecc-rpc-sidecar-'))
    const desktopLogDirectory = join(tempDir, 'desktop-logs')
    const first = new EccRpcSidecarProcess({
      logDirectoryProvider: () => desktopLogDirectory,
      spawn: () => new FakeChild(),
      tempDir,
    })
    const second = new EccRpcSidecarProcess({
      logDirectoryProvider: () => desktopLogDirectory,
      spawn: () => new FakeChild(),
      tempDir,
    })

    await Promise.all([first.start(), second.start()])

    expect(first.logFile).not.toBe(second.logFile)
    expect(existsSync(first.logFile!)).toBe(true)
    expect(existsSync(second.logFile!)).toBe(true)
  })

  it('moves a legacy workspace log before rerun output is appended', async () => {
    const child = new FakeChild()
    const tempDir = mkdtempSync(join(tmpdir(), 'ecc-rpc-sidecar-'))
    const workspaceDirectory = join(tempDir, 'workspace')
    const workspaceLogDirectory = join(workspaceDirectory, 'log')
    const desktopLogDirectory = join(tempDir, 'desktop-logs')
    const legacyLogFile = join(workspaceLogDirectory, 'ecc-rpc-runtime-legacy.log')
    mkdirSync(workspaceLogDirectory, { recursive: true })
    writeFileSync(legacyLogFile, 'before rerun\n')

    const sidecar = new EccRpcSidecarProcess({
      logDirectoryProvider: () => desktopLogDirectory,
      spawn: () => child,
      tempDir,
    })
    await sidecar.start()
    sidecar.logFile = legacyLogFile

    sidecar.relocateLogFileFrom(workspaceDirectory)
    child.stderr.write('during rerun\n')

    expect(sidecar.logFile?.startsWith(`${desktopLogDirectory}/`)).toBe(true)
    expect(readFileSync(sidecar.logFile!, 'utf8')).toBe('before rerun\nduring rerun\n')
    expect(existsSync(legacyLogFile)).toBe(false)
  })

  it('rejects pending requests and emits an unexpected exit event', async () => {
    const child = new FakeChild()
    const events: unknown[] = []
    const sidecar = new EccRpcSidecarProcess({
      onEvent: (event) => events.push(event),
      spawn: () => child,
    })
    const client = await sidecar.start()
    const promise = client.call('rpc.ping')

    child.emit('close', 1, null)

    await expect(promise).rejects.toThrow('ECC RPC sidecar exited')
    expect(events).toContainEqual(
      expect.objectContaining({
        code: 1,
        reason: 'unexpected',
        signal: null,
        type: 'runtime.exited',
      }),
    )
  })

  it('fails shutdown after bounded signal escalation when rpc.shutdown times out', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const sidecar = new EccRpcSidecarProcess({
      shutdownTimeoutMs: 25,
      spawn: () => child,
    })

    await sidecar.start()
    const shutdown = sidecar.shutdown().catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(25)
    expect(child.signals).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
    await vi.advanceTimersByTimeAsync(25)
    await expect(shutdown).resolves.toMatchObject({
      message: 'ECC RPC sidecar did not exit after SIGKILL.',
    })
  })
})
