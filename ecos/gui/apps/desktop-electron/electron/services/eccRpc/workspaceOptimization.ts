import type { DesktopAgentWorkspaceRerunContract } from '@ecos-studio/shared'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { executeWorkspaceRerun, prepareWorkspaceRerun } from './workspaceRerun'

export interface PlaceOptimizationEvidence {
  artifactRefs: string[]
  hpwl: number
  metrics: Record<string, number>
}

export interface PlaceOptimizationEvaluation {
  candidateId: string
  evidence?: PlaceOptimizationEvidence
  reason?: string
  status: 'succeeded' | 'failed'
}

export interface PlaceOptimizationExecutor {
  prepare(contract: DesktopAgentWorkspaceRerunContract): Promise<{ directory: string }>
  execute(contract: DesktopAgentWorkspaceRerunContract): Promise<void>
  readEvidence(directory: string): Promise<PlaceOptimizationEvidence>
}

export function createFixedPlaceOptimizationExecutor(
  runtime: {
    runCandidateRerun(request: {
      candidateId: string
      endStep: string
      executionScope: 'single_step' | 'full_flow'
      patch: Array<{ knob_id: string; value: unknown }>
      targetStep: string
      workspaceHandle: string
    }): Promise<unknown>
  },
  workspaceHandleFor: (directory: string) => string,
): PlaceOptimizationExecutor {
  return {
    prepare: prepareWorkspaceRerun,
    execute: async (contract) =>
      executeWorkspaceRerun(
        contract,
        runtime,
        workspaceHandleFor(contract.target_workspace),
      ),
    readEvidence: readPlaceOptimizationEvidence,
  }
}

export async function executePlaceOptimization(
  contracts: DesktopAgentWorkspaceRerunContract[],
  executor: PlaceOptimizationExecutor,
): Promise<{
  bestCandidateId?: string
  evaluations: PlaceOptimizationEvaluation[]
}> {
  validateContracts(contracts)
  const evaluations: PlaceOptimizationEvaluation[] = []
  for (const contract of contracts) {
    try {
      const prepared = await executor.prepare(contract)
      await executor.execute(contract)
      const evidence = await executor.readEvidence(prepared.directory)
      if (!Number.isFinite(evidence.hpwl) || evidence.hpwl <= 0) {
        throw new Error('place HPWL evidence is invalid')
      }
      evaluations.push({ candidateId: contract.rerun_id, evidence, status: 'succeeded' })
    } catch (error) {
      evaluations.push({
        candidateId: contract.rerun_id,
        reason: error instanceof Error ? error.message : String(error),
        status: 'failed',
      })
    }
  }
  const best = evaluations
    .filter(
      (item) =>
        item.candidateId !== contracts[0]?.rerun_id &&
        item.status === 'succeeded' &&
        item.evidence,
    )
    .sort((left, right) => left.evidence!.hpwl - right.evidence!.hpwl)[0]
  return { ...(best ? { bestCandidateId: best.candidateId } : {}), evaluations }
}

function validateContracts(contracts: DesktopAgentWorkspaceRerunContract[]): void {
  if (contracts.length !== 5) {
    throw new Error('place optimization requires one baseline and four candidates')
  }
  for (const contract of contracts) {
    const isPlaceOnly =
      contract.requires_gui_review &&
      contract.target_step === 'place' &&
      contract.end_step === 'place' &&
      contract.execution_scope === 'single_step' &&
      contract.parameter_patch.every((item) => item.knob_id === 'place.target_density')
    if (!isPlaceOnly)
      throw new Error('optimization requires frozen place-only rerun contracts')
  }
}

export async function readPlaceOptimizationEvidence(
  directory: string,
): Promise<PlaceOptimizationEvidence> {
  const relativePath = 'place_dreamplace/analysis/qor_metrics.json'
  const payload = JSON.parse(await readFile(join(directory, relativePath), 'utf8')) as {
    metrics?: Array<{ id?: unknown; value?: unknown }>
  }
  const metrics = Object.fromEntries(
    (payload.metrics ?? [])
      .filter(
        (item): item is { id: string; value: number } =>
          typeof item.id === 'string' && typeof item.value === 'number',
      )
      .map((item) => [item.id, item.value]),
  )
  const hpwl = metrics.place_hpwl
  if (typeof hpwl !== 'number') throw new Error('place HPWL is missing from QoR evidence')
  return { artifactRefs: [relativePath], hpwl, metrics }
}
