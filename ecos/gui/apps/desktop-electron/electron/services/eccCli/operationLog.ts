import { constants } from 'node:fs'
import { mkdir, open, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  EccRunHistoryEntry,
  EccRunHistoryPage,
  EccRunHistoryRequest,
} from '@ecos-studio/shared'

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

type RunTerminalState = EccRunHistoryEntry['state']

export type RunSelection = EccRunHistoryEntry['selection']
type RunResult = EccRunHistoryEntry

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

export async function readRunHistory(
  workspace: string,
  workspaceId: string,
  before: EccRunHistoryRequest['before'],
): Promise<EccRunHistoryPage> {
  let entries
  try {
    entries = await readdir(await workspaceLogDirectory(workspace), {
      withFileTypes: true,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { runs: [] }
    throw error
  }
  const ids = entries.flatMap((entry) => {
    const id = RUN_RESULT_FILE.exec(entry.name)?.[1]
    return entry.isFile() && id ? [id] : []
  })
  const pageSize = 30
  const latest: RunResult[] = []
  const compare = (left: NonNullable<typeof before>, right: NonNullable<typeof before>) =>
    right.finishedAt - left.finishedAt || right.runId.localeCompare(left.runId)
  for (let index = 0; index < ids.length; index += RECENT_RUN_LIMIT) {
    const batch = await Promise.all(
      ids
        .slice(index, index + RECENT_RUN_LIMIT)
        .map((id) => readRunResult(workspace, workspaceId, id)),
    )
    latest.push(
      ...batch.filter((run): run is RunResult =>
        Boolean(run && (!before || compare(run, before) > 0)),
      ),
    )
    latest.sort(compare)
    latest.length = Math.min(latest.length, pageSize + 1)
  }
  const runs = latest.slice(0, pageSize)
  const last = runs.at(-1)
  return {
    runs,
    ...(last && latest.length > pageSize
      ? { next: { finishedAt: last.finishedAt, runId: last.runId } }
      : {}),
  }
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
