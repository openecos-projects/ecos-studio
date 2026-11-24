import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  DesktopAgentOptimizationEpisodeSummary,
  DesktopAgentOptimizationRound,
} from '@ecos-studio/shared'

const MAX_LEDGER_BYTES = 8 * 1024 * 1024
const LEDGER_SCHEMA = 'ecos.optimization_ledger_entry.v2'

export async function readOptimizationRounds(
  episode: DesktopAgentOptimizationEpisodeSummary,
): Promise<DesktopAgentOptimizationRound[] | undefined> {
  if (!/^episode-[a-zA-Z0-9_-]{1,120}$/.test(episode.episodeId)) return
  if (!episode.parentWorkspaceDirectory) return

  try {
    const workspace = await realpath(episode.parentWorkspaceDirectory)
    const path = join(
      workspace,
      '.agent',
      'optimization',
      episode.episodeId,
      'optimization-outcomes.v1.jsonl',
    )
    if ((await realpath(path)) !== path) return
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > MAX_LEDGER_BYTES) return
      const buffer = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        )
        if (!bytesRead) break
        offset += bytesRead
      }
      return parseRounds(buffer.toString('utf8', 0, offset))
    } finally {
      await file.close()
    }
  } catch {
    // History is optional. A missing artifact must not hide episode controls or its result.
    return undefined
  }
}

function parseRounds(ledger: string): DesktopAgentOptimizationRound[] {
  const rounds = new Map<string, DesktopAgentOptimizationRound>()
  const primaryMetrics = new Map<string, string>()
  for (const line of ledger.split('\n')) {
    if (!line.trim()) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      // A projection can be requested while the last record is being appended.
      break
    }
    if (!isRecord(entry) || entry.schema_version !== LEDGER_SCHEMA) continue
    const payload = entry.payload
    if (!isRecord(payload)) continue
    const interventionId = identifier(payload.intervention_id)
    if (!interventionId) continue
    if (payload.record_type === 'intervention_started') {
      if (rounds.has(interventionId)) continue
      const round: DesktopAgentOptimizationRound = { interventionId }
      if (isRecord(payload.requested)) {
        const knob = identifier(payload.requested.knob_id)
        const value = payload.requested.value
        if (knob && (typeof value === 'boolean' || isFiniteNumber(value)))
          round.requested = { knob_id: knob, value }
      }
      const metric = isRecord(payload.active_objective)
        ? identifier(payload.active_objective.active_primary_metric)
        : undefined
      if (metric) primaryMetrics.set(interventionId, metric)
      rounds.set(interventionId, round)
    } else if (payload.record_type === 'terminal_outcome') {
      const round = rounds.get(interventionId)
      const outcome = identifier(payload.outcome)
      if (!round || round.outcome || !outcome) continue
      round.outcome = outcome
      round.decision = identifier(payload.incumbent_decision)
      const sha = payload.candidate_manifest_sha256
      if (typeof sha === 'string' && /^sha256:[a-f0-9]{64}$/.test(sha))
        round.manifestSha256 = sha
      if (!isRecord(payload.terminal_observation)) continue
      const { metrics, evaluation_metrics, signoff_gates } = payload.terminal_observation
      const metric = primaryMetrics.get(interventionId)
      if (metric) {
        const value =
          (isRecord(metrics) ? metrics[metric] : undefined) ??
          (isRecord(evaluation_metrics) ? evaluation_metrics[metric] : undefined)
        if (isFiniteNumber(value)) round.metric = { id: metric, value }
      }
      if (isRecord(signoff_gates)) {
        round.failedGates = Object.entries(signoff_gates).flatMap(([id, state]) =>
          state === 'fail' && identifier(id) ? [id] : [],
        )
      }
    }
  }
  return [...rounds.values()]
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)
    ? value
    : undefined
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
