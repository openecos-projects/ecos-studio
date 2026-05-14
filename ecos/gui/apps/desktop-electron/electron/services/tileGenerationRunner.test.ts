import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkerTileGenerationRunner,
  runTileGenerationJob,
  type TileGenerationWorkerLike,
} from './tileGenerationRunner'

class FakeWorker extends EventEmitter implements TileGenerationWorkerLike {}

describe('runTileGenerationJob', () => {
  it('spawns a worker with the tile generation job and resolves on completion', async () => {
    const worker = new FakeWorker()
    const workerFactory = vi.fn((job) => {
      setTimeout(() => {
        worker.emit('message', { job })
      }, 0)
      return worker
    })

    await expect(
      runTileGenerationJob(
        {
          layoutJsonPath: '/tmp/project/steps/layout.json',
          outDir: '/tmp/project/.ecos/tile-cache/layout/route',
        },
        workerFactory,
      ),
    ).resolves.toBeUndefined()

    expect(workerFactory).toHaveBeenCalledWith({
      layoutJsonPath: '/tmp/project/steps/layout.json',
      outDir: '/tmp/project/.ecos/tile-cache/layout/route',
    })
  })

  it('rejects when the worker raises an error', async () => {
    const worker = new FakeWorker()
    const workerFactory = vi.fn(() => {
      setTimeout(() => {
        worker.emit('error', new Error('worker-failed'))
      }, 0)
      return worker
    })

    await expect(
      runTileGenerationJob(
        {
          layoutJsonPath: '/tmp/project/steps/layout.json',
          outDir: '/tmp/project/.ecos/tile-cache/layout/route',
        },
        workerFactory,
      ),
    ).rejects.toThrow('worker-failed')
  })

  it('rejects when the worker exits before signalling completion', async () => {
    const worker = new FakeWorker()
    const workerFactory = vi.fn(() => {
      setTimeout(() => {
        worker.emit('exit', 1)
      }, 0)
      return worker
    })

    await expect(
      runTileGenerationJob(
        {
          layoutJsonPath: '/tmp/project/steps/layout.json',
          outDir: '/tmp/project/.ecos/tile-cache/layout/route',
        },
        workerFactory,
      ),
    ).rejects.toThrow('Tile generation worker exited with code 1')
  })
})

describe('WorkerTileGenerationRunner', () => {
  it('delegates tile generation jobs to the worker-backed runner', async () => {
    const worker = new FakeWorker()
    const workerFactory = vi.fn(() => {
      setTimeout(() => {
        worker.emit('message', 'done')
      }, 0)
      return worker
    })

    const runner = new WorkerTileGenerationRunner(workerFactory)

    await expect(
      runner.run(
        '/tmp/project/steps/layout.json',
        '/tmp/project/.ecos/tile-cache/layout/route',
      ),
    ).resolves.toBeUndefined()

    expect(workerFactory).toHaveBeenCalledWith({
      layoutJsonPath: '/tmp/project/steps/layout.json',
      outDir: '/tmp/project/.ecos/tile-cache/layout/route',
    })
  })
})
