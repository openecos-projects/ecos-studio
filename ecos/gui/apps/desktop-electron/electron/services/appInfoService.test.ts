import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { AppInfoService } from './appInfoService'

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
}

function createSpawnHarness() {
  const children: FakeChild[] = []
  const spawn = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child as never
  })

  return {
    children,
    spawn,
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('AppInfoService', () => {
  it('returns local GUI and structured ECC component versions without asking a server', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      env: { PATH: '/usr/bin' },
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    expect(harness.spawn).toHaveBeenCalledWith('ecc', ['version', '--json'], expect.objectContaining({
      env: { PATH: '/usr/bin' },
    }))

    harness.children[0].stdout.emit('data', JSON.stringify({
      schema_version: 1,
      runtime: 'ECC CLI',
      ecc: '0.1.0a5',
      dreamplace: '0.1.0a3',
      ecc_tools: '0.1.0a2',
    }))
    harness.children[0].emit('close', 0, null)

    await expect(promise).resolves.toEqual({
      dreamplace: '0.1.0a3',
      ecc: '0.1.0a5',
      eccTools: '0.1.0a2',
      gui: '0.1.0-alpha.5',
      runtime: 'ECC CLI',
    })
  })

  it('falls back to legacy ecc --version when structured discovery fails', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    harness.children[0].emit('close', 2, null)
    await flushAsyncWork()

    expect(harness.spawn).toHaveBeenLastCalledWith('ecc', ['--version'], expect.any(Object))

    harness.children[1].stdout.emit('data', 'ecc 0.1.0a5\n')
    harness.children[1].emit('close', 0, null)

    await expect(promise).resolves.toMatchObject({
      dreamplace: 'unknown',
      ecc: '0.1.0a5',
      eccTools: 'unknown',
      runtime: 'ECC CLI',
    })
  })

  it('falls back to legacy ecc --version when structured stdout is invalid JSON', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    harness.children[0].stdout.emit('data', 'not json\n')
    harness.children[0].emit('close', 0, null)
    await flushAsyncWork()

    expect(harness.spawn).toHaveBeenLastCalledWith('ecc', ['--version'], expect.any(Object))

    harness.children[1].stdout.emit('data', 'ecc 0.1.0a5\n')
    harness.children[1].emit('close', 0, null)

    await expect(promise).resolves.toMatchObject({
      ecc: '0.1.0a5',
      runtime: 'ECC CLI',
    })
  })

  it('falls back to legacy ecc --version when structured stdout is not an object', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    harness.children[0].stdout.emit('data', '[]')
    harness.children[0].emit('close', 0, null)
    await flushAsyncWork()

    expect(harness.spawn).toHaveBeenLastCalledWith('ecc', ['--version'], expect.any(Object))

    harness.children[1].stdout.emit('data', 'ecc 0.1.0a5\n')
    harness.children[1].emit('close', 0, null)

    await expect(promise).resolves.toMatchObject({
      ecc: '0.1.0a5',
      runtime: 'ECC CLI',
    })
  })

  it('defaults missing structured fields without rejecting version discovery', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    harness.children[0].stdout.emit('data', JSON.stringify({
      schema_version: 1,
      ecc: '0.1.0a5',
    }))
    harness.children[0].emit('close', 0, null)

    await expect(promise).resolves.toEqual({
      dreamplace: 'unknown',
      ecc: '0.1.0a5',
      eccTools: 'unknown',
      gui: '0.1.0-alpha.5',
      runtime: 'ECC CLI',
    })
  })

  it('returns unknown component versions when structured and legacy discovery fail', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    harness.children[0].emit('error', new Error('not found'))
    await flushAsyncWork()
    harness.children[1].emit('close', 127, null)

    await expect(promise).resolves.toMatchObject({
      dreamplace: 'unknown',
      ecc: 'unknown',
      eccTools: 'unknown',
      runtime: 'ECC CLI',
    })
  })
})
