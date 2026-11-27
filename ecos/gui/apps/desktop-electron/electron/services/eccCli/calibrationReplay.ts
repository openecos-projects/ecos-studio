import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { readBoundedJson, readProjectManifest } from './persistedState'

type ReplaySource = {
  directory: string
  projectId: string
  projectRoot: string
  workspaceId: string
}

export function calibrationReplayId(replayKey: string): string {
  if (!/^[0-9a-f]{64}$/.test(replayKey)) {
    throw new Error('Calibration replay identity is invalid.')
  }
  return `calibration-${replayKey}`
}

export async function releaseCalibrationReplay(
  source: ReplaySource,
  replayKey: string,
  callbacks: {
    reconcileProject(root: string): Promise<unknown>
    isRunning(directory: string): boolean
    deleteWorkspace(root: string, workspaceId: string): Promise<unknown>
    closeSession(directory: string): Promise<void>
  },
): Promise<{ ok: true }> {
  const workspaceId = calibrationReplayId(replayKey)
  const directory = join(source.projectRoot, workspaceId)
  const deadline = Date.now() + 25_000
  await callbacks.reconcileProject(source.projectRoot)
  for (;;) {
    const manifest = await readProjectManifest(source.projectRoot)
    if (manifest.project_id !== source.projectId) {
      throw new Error('Calibration source Project identity changed.')
    }
    const entry = manifest.workspaces.find((row) => row.workspace_id === workspaceId)
    if (!entry) {
      await callbacks.closeSession(directory)
      return { ok: true }
    }
    if (entry.workspace_path !== directory || directory === source.directory) {
      throw new Error('Calibration Workspace registration changed.')
    }
    await verifyCalibrationReplay(source, directory, workspaceId)
    try {
      if (callbacks.isRunning(directory)) {
        if (Date.now() >= deadline)
          throw new Error('Calibration replay is still running.')
        await delay(500)
        continue
      }
      await callbacks.deleteWorkspace(source.projectRoot, workspaceId)
    } catch (error) {
      if (
        !['workspace_busy', 'revision_conflict'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        ) ||
        Date.now() >= deadline
      )
        throw error
      await delay(500)
      continue
    }
    await callbacks.closeSession(directory)
    return { ok: true }
  }
}

export async function verifyCalibrationReplay(
  source: { directory: string; projectId: string; workspaceId: string },
  directory: string,
  workspaceId: string,
): Promise<void> {
  const receipt = join(directory, 'home', 'workspace-commands.json')
  if ((await realpath(receipt)) !== receipt) {
    throw new Error('Calibration replay receipt path changed.')
  }
  const ledger = (await readBoundedJson(receipt, 4 * 1024 * 1024)) as {
    commands?: Record<
      string,
      {
        metadata?: {
          operation?: string
          projectId?: string
          workspaceId?: string
          workspacePath?: string
          sourceWorkspaceId?: string
          request?: {
            directory?: string
            targetDirectory?: string
            resetFromStep?: string
          }
        }
      }
    >
  } | null
  const metadata = ledger?.commands?.[workspaceId]?.metadata
  if (
    metadata?.operation !== 'derive' ||
    metadata.projectId !== source.projectId ||
    metadata.workspaceId !== workspaceId ||
    metadata.workspacePath !== directory ||
    metadata.sourceWorkspaceId !== source.workspaceId ||
    metadata.request?.directory !== source.directory ||
    metadata.request.targetDirectory !== directory ||
    metadata.request.resetFromStep !== ''
  ) {
    throw new Error('Workspace was not created by this calibration replay.')
  }
}
