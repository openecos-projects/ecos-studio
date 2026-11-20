import { constants } from 'node:fs'
import { mkdir, open, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'

export function operationLogPath(runId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Invalid ECC run ID.')
  return `log/${runId}.log`
}

export async function openOperationLog(directory: string, runId: string, write = false) {
  const root = await realpath(directory)
  const logDirectory = join(root, 'log')
  if (write) await mkdir(logDirectory, { mode: 0o700, recursive: true })
  if ((await realpath(logDirectory)) !== logDirectory) {
    throw new Error('The Workspace log directory must not be a symbolic link.')
  }
  const flags = write
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND
    : constants.O_RDONLY
  const handle = await open(
    join(root, operationLogPath(runId)),
    flags | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  )
  try {
    if (!(await handle.stat()).isFile()) throw new Error('The ECC run log is not a file.')
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

export async function readOperationLog(directory: string, runId: string) {
  const handle = await openOperationLog(directory, runId)
  try {
    const { size } = await handle.stat()
    const offset = Math.max(0, size - 64 * 1024)
    const buffer = Buffer.alloc(size - offset)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    return {
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated: offset > 0,
    }
  } finally {
    await handle.close()
  }
}

type RunTerminalState = 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export interface RunSelection {
  only?: string
  fromStep?: string
  throughStep?: string
}

export interface RunResult {
  runId: string
  startedAt: number
  finishedAt: number
  state: RunTerminalState
  selection: RunSelection
  error?: { code: string; message: string }
}

export function readRunSelection(value: unknown): RunSelection {
  if (!value || typeof value !== 'object') return {}
  const scope = value as Record<string, unknown>
  const only = stepName(scope.only)
  if (only) return { only }
  const fromStep = stepName(scope.from_step)
  const throughStep = stepName(scope.through_step)
  return fromStep ? { fromStep, ...(throughStep ? { throughStep } : {}) } : {}
}

function stepName(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_@]+$/.test(value) && value.length <= 256
    ? value
    : undefined
}

const RUN_RESULT_FILE = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.run\.json$/
const MAX_RUN_RESULT_BYTES = 16 * 1024
export const RECENT_RUN_LIMIT = 64

async function workspaceLogDirectory(workspace: string): Promise<string> {
  const directory = join(await realpath(workspace), 'log')
  if ((await realpath(directory)) !== directory) {
    throw new Error('The Workspace log directory must not be a symbolic link.')
  }
  return directory
}

export async function readRunResult(
  workspace: string,
  workspaceId: string,
  runId: string,
): Promise<RunResult | undefined> {
  const name = `${runId}.run.json`
  if (!RUN_RESULT_FILE.test(name)) return
  try {
    const directory = await workspaceLogDirectory(workspace)
    const handle = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > MAX_RUN_RESULT_BYTES) return
      const buffer = Buffer.alloc(info.size)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const record = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
      if (
        record?.schema_version !== 1 ||
        record.run_id !== runId ||
        record.workspace_id !== workspaceId ||
        !Number.isFinite(record.started_at) ||
        record.started_at <= 0 ||
        !Number.isFinite(record.finished_at) ||
        record.finished_at < record.started_at ||
        !isRunTerminalState(record.state)
      )
        return
      return {
        runId,
        startedAt: record.started_at,
        finishedAt: record.finished_at,
        state: record.state,
        selection: readRunSelection(record),
        error: parseRunError(record.error),
      }
    } finally {
      await handle.close()
    }
  } catch {
    // An older ECC run or an interrupted process may have no result record.
  }
}

export async function recentRunResults(workspace: string, workspaceId: string) {
  const directory = await workspaceLogDirectory(workspace).catch(() => null)
  if (!directory) return []
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = entries.flatMap((entry) => {
    const match = RUN_RESULT_FILE.exec(entry.name)
    return entry.isFile() && match?.[1] ? [{ name: entry.name, runId: match[1] }] : []
  })
  const dated = []
  // Limit concurrent opens in Workspaces with long histories.
  for (let index = 0; index < files.length; index += RECENT_RUN_LIMIT) {
    const batch = await Promise.all(
      files.slice(index, index + RECENT_RUN_LIMIT).map(async (file) => ({
        runId: file.runId,
        mtime: (await stat(join(directory, file.name)).catch(() => null))?.mtimeMs ?? 0,
      })),
    )
    dated.push(...batch)
  }
  const results = await Promise.all(
    dated
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, RECENT_RUN_LIMIT)
      .map(({ runId }) => readRunResult(workspace, workspaceId, runId)),
  )
  return results.filter((result) => result !== undefined)
}

function isRunTerminalState(value: unknown): value is RunTerminalState {
  return (
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'interrupted'
  )
}

function parseRunError(value: unknown): RunResult['error'] {
  if (!value || typeof value !== 'object') return
  const { code, message } = value as Record<string, unknown>
  if (typeof code !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(code)) return
  const detail =
    typeof message === 'string'
      ? message
          .replace(/\p{Cc}/gu, ' ')
          .trim()
          .slice(0, 500)
      : ''
  return { code, message: detail || 'ECC could not run. See the run log.' }
}

export function readRunFailure(
  content: string,
): { code: string; message: string } | undefined {
  for (const line of content.split('\n').reverse()) {
    const match = /^kind=error error=([a-z][a-z0-9_]{0,79})(?:\s|$)/.exec(line)
    if (!match) continue
    const code = match[1]!
    const reasonField = /(?:^| )reason=("(?:\\.|[^"\\])*"|[^ ]+)(?: |$)/.exec(line)?.[1]
    let reason = reasonField ?? ''
    if (reason.startsWith('"')) {
      try {
        reason = JSON.parse(reason) as string
      } catch {
        reason = ''
      }
    }
    const message = reason
      .replace(/\p{Cc}/gu, ' ')
      .trim()
      .slice(0, 500)
    return {
      code,
      message:
        message ||
        (code === 'revision_conflict'
          ? 'The Workspace changed before ECC could start. Refresh it and try again.'
          : 'ECC could not run. See the run log.'),
    }
  }
}
