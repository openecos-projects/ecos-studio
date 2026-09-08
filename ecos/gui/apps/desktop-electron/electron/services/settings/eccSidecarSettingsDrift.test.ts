import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { EccRpcSidecarProcess, type SpawnedEccRpcSidecar } from '../eccRpc/sidecarProcess'
import { encodeContentLengthFrame } from '../eccRpc/transport'
import { createEccSidecarLaunchHooks, ECC_SIZER_ROOT_ENV_KEY } from './eccSidecarLaunch'

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

  kill(): boolean {
    return true
  }
}

interface RecordedSpawn {
  command: string
  env: NodeJS.ProcessEnv
}

function createHooks(settings: Map<string, unknown>) {
  return createEccSidecarLaunchHooks({
    baseEnvProvider: async () => ({ BASE: '1' }),
    resolveDefaultExecutable: () => '/opt/studio/binaries/ecc',
    settingsStore: {
      get: async <T>(key: string): Promise<T | null> =>
        settings.has(key) ? (settings.get(key) as T) : null,
    },
  })
}

/** Acknowledge the rpc.shutdown frame, then let the old child exit. */
async function completeRestart(
  sidecar: EccRpcSidecarProcess,
  previousChild: FakeChild,
): Promise<unknown> {
  const restart = sidecar.start()
  await vi.waitFor(() => {
    expect(previousChild.stdin.chunks).toHaveLength(1)
  })
  previousChild.stdout.write(
    encodeContentLengthFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'),
  )
  previousChild.emit('close', 0, null)
  return await restart
}

describe('ECC sidecar settings drift', () => {
  it('respawns with the user override on the next start and restores the default after reset', async () => {
    const settings = new Map<string, unknown>()
    const hooks = createHooks(settings)
    const spawns: RecordedSpawn[] = []
    const spawnImpl = vi.fn(
      (_command: string, _args: string[], _options: { env: NodeJS.ProcessEnv }) => {
        const child = new FakeChild()
        spawns.push({ command: _command, env: _options.env })
        return child
      },
    )
    const sidecar = new EccRpcSidecarProcess({
      env: { BASE: '1' },
      envProvider: hooks.envProvider,
      resolveLaunch: hooks.resolveLaunch,
      spawn: spawnImpl as never,
    })

    // First start uses the packaged/dev default without a sizer override.
    await sidecar.start()
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.command).toBe('/opt/studio/binaries/ecc')
    expect(spawns[0]?.env[ECC_SIZER_ROOT_ENV_KEY]).toBeUndefined()

    // Persisting user overrides changes what resolveLaunch/envProvider return;
    // the next start detects the launch/env drift and respawns transparently.
    // The override must exist on disk or the launch hooks fall back.
    const { chmodSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs')
    mkdirSync('/tmp/ecos-drift-custom', { recursive: true })
    const userEcc = '/tmp/ecos-drift-custom/ecc'
    writeFileSync(userEcc, '#!/usr/bin/env bash\necho ok\n')
    chmodSync(userEcc, 0o755)
    settings.set('runtime.eccPath', userEcc)
    settings.set('runtime.eccSizerRoot', '/opt/ecc-sizer')
    const firstChild = spawnImpl.mock.results[0]?.value as FakeChild
    await completeRestart(sidecar, firstChild)
    expect(spawns).toHaveLength(2)
    expect(spawns[1]?.command).toBe(userEcc)
    expect(spawns[1]?.env[ECC_SIZER_ROOT_ENV_KEY]).toBe('/opt/ecc-sizer')
    expect(spawns[1]?.env.BASE).toBe('1')
    rmSync('/tmp/ecos-drift-custom', { force: true, recursive: true })

    // Reset deletes both keys; the next start falls back to the default.
    settings.delete('runtime.eccPath')
    settings.delete('runtime.eccSizerRoot')
    const secondChild = spawnImpl.mock.results[1]?.value as FakeChild
    await completeRestart(sidecar, secondChild)
    expect(spawns).toHaveLength(3)
    expect(spawns[2]?.command).toBe('/opt/studio/binaries/ecc')
    expect(spawns[2]?.env[ECC_SIZER_ROOT_ENV_KEY]).toBeUndefined()
  })
})
