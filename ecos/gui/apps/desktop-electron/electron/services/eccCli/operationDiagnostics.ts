import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import type {
  EccBackgroundOperationLogResult,
  EccRuntimeOperation,
} from '@ecos-studio/shared'
import type { readOperationLog } from './operationLog'

export async function buildOperationDiagnostics(
  operation: EccRuntimeOperation,
  runLog: Awaited<ReturnType<typeof readOperationLog>> | null,
  workers: readonly string[],
  mainLogFile?: string,
  persistedOnly = false,
): Promise<EccBackgroundOperationLogResult> {
  const { operationId, state, error } = operation
  const desktopLog = mainLogFile
    ? await desktopRunMessages(mainLogFile, operationId).catch(() => '')
    : ''
  return {
    content: runLog?.content ?? '',
    truncated: runLog?.truncated ?? false,
    diagnostics: [
      'ECC run diagnostics',
      `Run ID: ${operationId}`,
      `Workspace: ${operation.workspaceId}`,
      ...(persistedOnly ? [] : [`Origin: ${operation.origin}`]),
      `Scope: ${
        operation.step ||
        (operation.flowScope?.fromStep
          ? `${operation.flowScope.fromStep} → ${operation.flowScope.throughStep ?? 'end'}`
          : 'Full flow')
      }`,
      `State: ${state}`,
      ...(error ? [`Error: ${error.code}\n${error.message}`] : []),
      '',
      'ECC run log',
      runLog
        ? `${runLog.truncated ? '[Tail only]\n' : ''}${runLog.content}`
        : 'Unavailable',
      '',
      'Failed worker attempts',
      workers.join('\n\n') || 'No matching worker details available',
      '',
      'Studio session log entries for this run',
      desktopLog || 'No matching entries available',
      '',
    ].join('\n'),
  }
}

async function desktopRunMessages(path: string, runId: string): Promise<string> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const stat = await file.stat()
    if (!stat.isFile()) return ''
    const { size } = stat
    const buffer = Buffer.alloc(Math.min(size, 128 * 1024))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, size - buffer.length)
    return buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .split('\n')
      .filter((line) => line.includes(`[runtime] ECC run ${runId} ended in `))
      .join('\n')
  } finally {
    await file.close()
  }
}
