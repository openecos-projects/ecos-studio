import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  EccWorkspaceRuntimeSnapshot,
  EccRuntimeStepSnapshot,
} from '@ecos-studio/shared'

import { migrateWorkspaceConfigFilenames } from './workspaceConfigMigration'
import {
  locateWorkspaceParametersFile,
  parseWorkspaceParametersText,
} from '../workspaceParametersFile'

const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024

type DetachedWorkspaceSnapshot = Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>

export interface WorkspaceBaselineSnapshot {
  db: Record<string, unknown>
  parameters: Record<string, unknown>
  pdk: Record<string, unknown>
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const metadata = await stat(path)
    if (metadata.size > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(
        `Workspace snapshot resource exceeds ${MAX_SNAPSHOT_FILE_BYTES} bytes: ${path}`,
      )
    }
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

/**
 * Parameters companion of readJsonObject: same size cap and ENOENT-tolerance,
 * but format-aware (home/ecc.toml preferred, legacy parameters.json fallback).
 */
async function readParametersObject(directory: string): Promise<Record<string, unknown>> {
  const location = await locateWorkspaceParametersFile(directory)
  if (!location) return {}
  try {
    const metadata = await stat(location.path)
    if (metadata.size > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(
        `Workspace snapshot resource exceeds ${MAX_SNAPSHOT_FILE_BYTES} bytes: ${location.path}`,
      )
    }
    return parseWorkspaceParametersText(
      await readFile(location.path, 'utf8'),
      location.format,
      directory,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

function flowStepsFrom(flow: Record<string, unknown>): EccRuntimeStepSnapshot[] {
  const rawSteps = Array.isArray(flow.steps) ? flow.steps : []
  return rawSteps.flatMap((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return []
    const step = rawStep as Record<string, unknown>
    if (typeof step.name !== 'string' || typeof step.tool !== 'string') return []
    return [
      {
        name: step.name,
        peakMemory:
          typeof step['peak memory (mb)'] === 'number' ? step['peak memory (mb)'] : 0,
        runtime: typeof step.runtime === 'string' ? step.runtime : '',
        state: typeof step.state === 'string' ? step.state : 'Unstart',
        tool: step.tool,
      },
    ]
  })
}

/**
 * A bounded, one-shot read path for an idle workspace. It intentionally reads
 * only the three lightweight JSON summaries and never traverses directories,
 * watches paths, or transfers logs/artifacts to the renderer.
 */
export class WorkspaceSnapshotLoader {
  async load(directory: string): Promise<DetachedWorkspaceSnapshot> {
    await migrateWorkspaceConfigFilenames(directory)
    const homeDirectory = join(directory, 'home')
    const [home, flow, parameters] = await Promise.all([
      readJsonObject(join(homeDirectory, 'home.json')),
      readJsonObject(join(homeDirectory, 'flow.json')),
      readParametersObject(directory),
    ])
    return {
      directory,
      flow: { steps: flowStepsFrom(flow) },
      home,
      lastEventId: `disk:${Date.now()}`,
      operations: [],
      parameters,
    }
  }

  /**
   * Reads only the persisted configuration needed to refresh a project
   * baseline. The same per-file size limit as idle runtime recovery applies.
   */
  async loadBaselineSnapshot(directory: string): Promise<WorkspaceBaselineSnapshot> {
    await migrateWorkspaceConfigFilenames(directory)
    const [parameters, pdk, db] = await Promise.all([
      readParametersObject(directory),
      readJsonObject(join(directory, 'home', 'pdk.json')),
      readJsonObject(join(directory, 'config', 'db_ecc.json')),
    ])
    return { db, parameters, pdk }
  }
}
