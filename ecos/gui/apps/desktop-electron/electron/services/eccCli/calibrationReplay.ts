import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { readBoundedJson } from './persistedState'

export function calibrationReplayId(replayKey: string): string {
  if (!/^[0-9a-f]{64}$/.test(replayKey)) {
    throw new Error('Calibration replay identity is invalid.')
  }
  return `calibration-${replayKey}`
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
