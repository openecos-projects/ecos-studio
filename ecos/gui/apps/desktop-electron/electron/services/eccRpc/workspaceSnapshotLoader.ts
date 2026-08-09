import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  EccWorkspaceRuntimeSnapshot,
  EccRuntimeStepSnapshot,
} from '@ecos-studio/shared'

const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024

type DetachedWorkspaceSnapshot = Omit<EccWorkspaceRuntimeSnapshot, 'workspaceHandle'>

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const metadata = await stat(path)
    if (metadata.size > MAX_SNAPSHOT_FILE_BYTES) {
      throw new Error(`Workspace snapshot resource exceeds ${MAX_SNAPSHOT_FILE_BYTES} bytes: ${path}`)
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

function flowStepsFrom(flow: Record<string, unknown>): EccRuntimeStepSnapshot[] {
  const rawSteps = Array.isArray(flow.steps) ? flow.steps : []
  return rawSteps.flatMap((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return []
    const step = rawStep as Record<string, unknown>
    if (typeof step.name !== 'string' || typeof step.tool !== 'string') return []
    return [{
      name: step.name,
      peakMemory:
        typeof step['peak memory (mb)'] === 'number' ? step['peak memory (mb)'] : 0,
      runtime: typeof step.runtime === 'string' ? step.runtime : '',
      state: typeof step.state === 'string' ? step.state : 'Unstart',
      tool: step.tool,
    }]
  })
}

/**
 * A bounded, one-shot read path for an idle workspace. It intentionally reads
 * only the three lightweight JSON summaries and never traverses directories,
 * watches paths, or transfers logs/artifacts to the renderer.
 */
export class WorkspaceSnapshotLoader {
  async load(directory: string): Promise<DetachedWorkspaceSnapshot> {
    const homeDirectory = join(directory, 'home')
    const [home, flow, parameters] = await Promise.all([
      readJsonObject(join(homeDirectory, 'home.json')),
      readJsonObject(join(homeDirectory, 'flow.json')),
      readJsonObject(join(homeDirectory, 'parameters.json')),
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
}
