import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EccRpcSidecarProcess, type SpawnedEccRpcSidecar } from './sidecarProcess'
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

  it('uses a runtime-specific launch resolver', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => child)
    const resolveLaunch = vi.fn(() => ({
      args: ['-m', 'fecompiler.cli.main', 'rpc', 'serve', '--stdio'],
      command: 'python3',
      env: { PATH: '/bin', PYTHONPATH: '/work/ecc-fe' },
    }))
    const sidecar = new EccRpcSidecarProcess({
      env: { PATH: '/bin' },
      resolveLaunch,
      spawn,
    })

    await sidecar.start()

    expect(resolveLaunch).toHaveBeenCalledWith({ PATH: '/bin' })
    expect(spawn).toHaveBeenCalledWith(
      'python3',
      ['-m', 'fecompiler.cli.main', 'rpc', 'serve', '--stdio'],
      {
        env: { PATH: '/bin', PYTHONPATH: '/work/ecc-fe' },
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

  it('sends SIGTERM and then SIGKILL when rpc.shutdown times out', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    const sidecar = new EccRpcSidecarProcess({
      shutdownTimeoutMs: 25,
      spawn: () => child,
    })

    await sidecar.start()
    const shutdown = sidecar.shutdown()

    await vi.advanceTimersByTimeAsync(25)
    await shutdown
    expect(child.signals).toEqual(['SIGTERM'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })
})
