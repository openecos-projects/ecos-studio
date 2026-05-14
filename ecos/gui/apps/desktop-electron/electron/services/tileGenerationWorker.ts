import { parentPort, workerData } from 'node:worker_threads'
import { generateLayoutTiles } from '@ecos-studio/tile-helper'
import type { TileGenerationJob } from './tileGenerationRunner'

const { layoutJsonPath, outDir } = workerData as TileGenerationJob

await generateLayoutTiles(layoutJsonPath, outDir)
parentPort?.postMessage('done')
