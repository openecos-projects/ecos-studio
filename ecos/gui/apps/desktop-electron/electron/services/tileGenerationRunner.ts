export interface TileGenerationJob {
  layoutJsonPath: string
  outDir: string
}

export interface TileGenerationWorkerLike {
  off(event: 'message', listener: () => void): this
  off(event: 'error', listener: (error: Error) => void): this
  off(event: 'exit', listener: (code: number) => void): this
  once(event: 'message', listener: () => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number) => void): this
}

export type TileGenerationWorkerFactory = (
  job: TileGenerationJob,
) => TileGenerationWorkerLike | Promise<TileGenerationWorkerLike>

export interface TileGenerationRunner {
  run(layoutJsonPath: string, outDir: string): Promise<void>
}

export async function spawnTileGenerationWorker(
  job: TileGenerationJob,
): Promise<TileGenerationWorkerLike> {
  const { default: createTileGenerationWorker } = await import('./tileGenerationWorker?nodeWorker')

  return createTileGenerationWorker({
    workerData: job,
  })
}

export async function runTileGenerationJob(
  job: TileGenerationJob,
  workerFactory: TileGenerationWorkerFactory = spawnTileGenerationWorker,
): Promise<void> {
  const worker = await workerFactory(job)

  await new Promise<void>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      worker.off('message', handleMessage)
      worker.off('error', handleError)
      worker.off('exit', handleExit)
    }

    const settle = (callback: () => void | never) => {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      callback()
    }

    const handleMessage = () => {
      settle(resolve)
    }

    const handleError = (error: Error) => {
      settle(() => reject(error))
    }

    const handleExit = (code: number) => {
      if (code === 0) {
        settle(() => reject(new Error('Tile generation worker exited before completing.')))
        return
      }

      settle(() => reject(new Error(`Tile generation worker exited with code ${code}`)))
    }

    worker.once('message', handleMessage)
    worker.once('error', handleError)
    worker.once('exit', handleExit)
  })
}

export class WorkerTileGenerationRunner implements TileGenerationRunner {
  private readonly workerFactory: TileGenerationWorkerFactory

  constructor(workerFactory: TileGenerationWorkerFactory = spawnTileGenerationWorker) {
    this.workerFactory = workerFactory
  }

  async run(layoutJsonPath: string, outDir: string): Promise<void> {
    await runTileGenerationJob({ layoutJsonPath, outDir }, this.workerFactory)
  }
}
