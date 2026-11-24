import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { DesktopAgentOptimizationEpisodeSummary } from '@ecos-studio/shared'
import { readOptimizationRounds } from './optimizationRounds'

it('joins simultaneous candidates by intervention and keeps dispatch order', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'optimization-rounds-'))
  try {
    const episode: DesktopAgentOptimizationEpisodeSummary = {
      agentSessionId: 'session-1',
      episodeId: 'episode-1',
      parentWorkspaceDirectory: workspace,
      inFlightCount: 1,
      optimization: {
        episode_id: 'episode-1',
        schema_version: 'ecos.optimization_status.v2',
      },
      providerId: 'codex',
      startedAt: 1,
      state: 'running',
      turnCount: 2,
      updatedAt: 2,
    }
    const directory = join(workspace, '.agent', 'optimization', episode.episodeId)
    const ledger = join(directory, 'optimization-outcomes.v1.jsonl')
    await mkdir(directory, { recursive: true })
    const entries = [
      start('intervention-1', 0.35),
      start('intervention-2', 0.45),
      {
        record_type: 'terminal_outcome',
        intervention_id: 'intervention-2',
        outcome: 'improved',
        incumbent_decision: 'candidate_better',
        terminal_observation: { metrics: { route_wirelength: 5934.4 } },
      },
    ].map((payload) =>
      JSON.stringify({ schema_version: 'ecos.optimization_ledger_entry.v2', payload }),
    )
    await writeFile(ledger, [...entries, '{"incomplete"'].join('\n'))

    await expect(readOptimizationRounds(episode)).resolves.toEqual([
      {
        interventionId: 'intervention-1',
        requested: { knob_id: 'place.target_density', value: 0.35 },
      },
      {
        interventionId: 'intervention-2',
        requested: { knob_id: 'place.target_density', value: 0.45 },
        outcome: 'improved',
        decision: 'candidate_better',
        metric: { id: 'route_wirelength', value: 5934.4 },
      },
    ])

    const target = join(workspace, 'other.jsonl')
    await writeFile(target, entries.join('\n'))
    await rm(ledger)
    await symlink(target, ledger)
    await expect(readOptimizationRounds(episode)).resolves.toBeUndefined()
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

function start(id: string, value: number) {
  return {
    record_type: 'intervention_started',
    intervention_id: id,
    requested: { knob_id: 'place.target_density', value },
    active_objective: { active_primary_metric: 'route_wirelength' },
  }
}
