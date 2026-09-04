import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024

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

export class WorkspaceSnapshotLoader {
  /** Reads only the persisted configuration needed to refresh a project baseline. */
  async loadBaselineSnapshot(directory: string): Promise<WorkspaceBaselineSnapshot> {
    const [parameters, pdk, db] = await Promise.all([
      readJsonObject(join(directory, 'home', 'parameters.json')),
      readJsonObject(join(directory, 'home', 'pdk.json')),
      readJsonObject(join(directory, 'config', 'db_ecc.json')),
    ])
    return { db, parameters, pdk }
  }
}
