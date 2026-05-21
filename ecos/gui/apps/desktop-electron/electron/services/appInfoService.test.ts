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

describe('AppInfoService', () => {
  it('returns local GUI, runtime, and ECC versions without asking a server', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      env: { PATH: '/usr/bin' },
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    expect(harness.spawn).toHaveBeenCalledWith('ecc', ['--version'], expect.objectContaining({
      env: { PATH: '/usr/bin' },
    }))

    harness.children[0].stdout.emit('data', 'ecc 0.1.0a5\n')
    harness.children[0].emit('close', 0, null)

    await expect(promise).resolves.toEqual({
      dreamplace: 'unknown',
      ecc: 'ecc 0.1.0a5',
      gui: '0.1.0-alpha.5',
      runtime: 'ECC CLI',
    })
  })

  it('falls back to unknown when ecc --version fails', async () => {
    const harness = createSpawnHarness()
    const service = new AppInfoService({
      appVersionProvider: () => '0.1.0-alpha.5',
      spawn: harness.spawn,
    })
    const promise = service.getVersions()

    harness.children[0].stderr.emit('data', 'not found\n')
    harness.children[0].emit('close', 127, null)

    await expect(promise).resolves.toMatchObject({
      ecc: 'unknown',
      runtime: 'ECC CLI',
    })
  })
})
