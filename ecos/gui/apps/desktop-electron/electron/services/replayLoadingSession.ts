import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReplayLoadingProgress } from '@ecos-studio/shared'

const MAX_STATUS_BYTES = 8192

function parseProgress(value: unknown): ReplayLoadingProgress | undefined {
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>
  if (row.state !== 'loading' && row.state !== 'ready') return
  if (typeof row.phase !== 'string' || row.phase.length > 512) return
  if (typeof row.name !== 'string' || row.name.length > 512) return
  const count = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (!count(row.step) || !count(row.steps) || row.step > row.steps) return
  if (!count(row.frame) || !count(row.frames) || row.frame > row.frames) return
  return {
    state: row.state,
    phase: row.phase,
    name: row.name,
    step: row.step,
    steps: row.steps,
    frame: row.frame,
    frames: row.frames,
  }
}

/** Per-process, app-owned temporary status file. Never read arbitrary renderer paths. */
export class ReplayLoadingSession {
  private latest: ReplayLoadingProgress = {
    state: 'loading',
    phase: 'Starting Chip Viewer',
    name: '',
    step: 0,
    steps: 0,
    frame: 0,
    frames: 0,
  }

  private constructor(
    private readonly directory: string,
    readonly path: string,
  ) {}

  static async create(): Promise<ReplayLoadingSession> {
    const directory = await mkdtemp(join(tmpdir(), 'ecos-replay-'))
    const session = new ReplayLoadingSession(directory, join(directory, 'progress.json'))
    try {
      await writeFile(session.path, JSON.stringify(session.latest), { mode: 0o600 })
      return session
    } catch (error) {
      await session.dispose()
      throw error
    }
  }

  async read(): Promise<ReplayLoadingProgress> {
    // Bound bytes before parsing. Atomic native writes normally avoid partial data;
    // retaining the last valid snapshot also covers a racing exit or bad producer.
    try {
      const file = await open(this.path, 'r')
      try {
        const buffer = Buffer.alloc(MAX_STATUS_BYTES + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead <= MAX_STATUS_BYTES) {
          const parsed = parseProgress(
            JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')),
          )
          if (parsed) this.latest = parsed
        }
      } finally {
        await file.close()
      }
    } catch {
      /* A previous valid snapshot remains usable during shutdown. */
    }
    return { ...this.latest }
  }

  async dispose(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
