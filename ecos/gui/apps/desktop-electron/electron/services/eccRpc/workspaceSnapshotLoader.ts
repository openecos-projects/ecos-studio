import { lstat, open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, sep } from 'node:path'
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

/**
 * Bounded, symlink-refusing file read for snapshot resources: the resolved
 * path must stay inside the workspace (a symlinked ancestor like
 * `home -> /outside` is rejected), the leaf is opened once with O_NOFOLLOW,
 * and the size cap is enforced on the opened handle — so a replacement
 * planted between checks and open cannot smuggle in a symlink or an
 * oversized file. The parent containment is revalidated after the read, so
 * a mid-read swap discards the data instead of returning it.
 */
async function readSnapshotText(
  path: string,
  workspaceDirectory: string,
): Promise<string> {
  const resolvedRoot = await realpath(workspaceDirectory)
  const assertContained = async (): Promise<void> => {
    const resolvedPath = await realpath(path)
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + sep)) {
      throw new Error(
        `Refusing to read workspace snapshot resource outside the workspace: ${path}`,
      )
    }
  }

  const metadata = await lstat(path)
  if (metadata.isSymbolicLink()) {
    throw new Error(
      `Refusing to read workspace snapshot resource through a symlink: ${path}`,
    )
  }
  await assertContained()
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (opened.size > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(
        `Workspace snapshot resource exceeds ${MAX_SNAPSHOT_FILE_BYTES} bytes: ${path}`,
      )
    }
    // Bound the actual read, not just the pre-read size: another process
    // can append after stat() and handle.readFile() would otherwise consume
    // the expanded file into the renderer snapshot. Loop until EOF or the
    // cap: a single FileHandle.read() may return a short count.
    const buffer = Buffer.allocUnsafe(MAX_SNAPSHOT_FILE_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read({
        buffer,
        length: buffer.length - total,
        offset: total,
        position: total,
      })
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(
        `Workspace snapshot resource exceeds ${MAX_SNAPSHOT_FILE_BYTES} bytes: ${path}`,
      )
    }
    const text = buffer.subarray(0, total).toString('utf8')
    await assertContained()
    return text
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error(
        `Refusing to read workspace snapshot resource through a symlink: ${path}`,
      )
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function readJsonObject(
  path: string,
  workspaceDirectory: string,
): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readSnapshotText(path, workspaceDirectory))
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
 * but format-aware (home/params.toml preferred, home/parameters.json fallback).
 */
async function readParametersObject(directory: string): Promise<Record<string, unknown>> {
  const location = await locateWorkspaceParametersFile(directory)
  if (!location) return {}
  try {
    return parseWorkspaceParametersText(
      await readSnapshotText(location.path, directory),
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
      readJsonObject(join(homeDirectory, 'home.json'), directory),
      readJsonObject(join(homeDirectory, 'flow.json'), directory),
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
      readJsonObject(join(directory, 'home', 'pdk.json'), directory),
      readJsonObject(join(directory, 'config', 'db_ecc.json'), directory),
    ])
    return { db, parameters, pdk }
  }
}
