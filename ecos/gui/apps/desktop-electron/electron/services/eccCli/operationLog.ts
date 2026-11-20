import { constants } from 'node:fs'
import { mkdir, open, realpath } from 'node:fs/promises'
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
