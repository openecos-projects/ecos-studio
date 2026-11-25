import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  EccPersistedEngineeringSnapshot,
  EccWorkspaceStepOutputArtifact,
  EccWorkspaceStepOutputsResult,
  ReadSection,
} from '@ecos-studio/shared'
import {
  ENGINEERING_SNAPSHOT_MAX_BYTES,
  validateEngineeringSnapshot,
} from '@ecos-studio/shared'
import { isWorkspaceStepDirectory } from '../workspaceStepDirectory'

function readyData<T>(section: ReadSection<T>): T {
  if (section.status !== 'ready') throw new Error(section.issues[0]?.code)
  return section.data
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function outputArtifact(value: unknown): EccWorkspaceStepOutputArtifact | null {
  if (
    !isRecord(value) ||
    typeof value.path !== 'string' ||
    typeof value.exists !== 'boolean'
  )
    return null
  const path = value.path
  if (!path.split('/').every(isWorkspaceStepDirectory)) return null
  return { path, exists: value.exists }
}

function stepOutputs(value: unknown): EccWorkspaceStepOutputsResult | undefined {
  if (
    !isRecord(value) ||
    typeof value.design !== 'string' ||
    value.directory !== '.' ||
    !Array.isArray(value.steps)
  )
    return
  return {
    design: value.design,
    directory: value.directory,
    sdc: outputArtifact(value.sdc),
    steps: value.steps.flatMap((step) =>
      isRecord(step) &&
      typeof step.step === 'string' &&
      typeof step.tool === 'string' &&
      typeof step.state === 'string'
        ? [
            {
              step: step.step,
              tool: step.tool,
              state: step.state,
              def: outputArtifact(step.def),
              verilog: outputArtifact(step.verilog),
            },
          ]
        : [],
    ),
  }
}

export async function readPersistedEngineeringSnapshot(
  directory: string,
  expectedWorkspaceId?: string,
): Promise<EccPersistedEngineeringSnapshot> {
  const path = join(directory, 'home', 'engineering-snapshot.json')
  let content: string
  try {
    if ((await stat(path)).size > ENGINEERING_SNAPSHOT_MAX_BYTES) {
      throw new Error('ENGINEERING_SNAPSHOT_TOO_LARGE')
    }
    content = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `ENGINEERING_SNAPSHOT_READ_FAILED: ${error.message}`
        : 'ENGINEERING_SNAPSHOT_READ_FAILED',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('ENGINEERING_SNAPSHOT_INVALID')
  }
  if (!isRecord(parsed)) throw new Error('ENGINEERING_SNAPSHOT_INVALID')
  const validated = validateEngineeringSnapshot(parsed, expectedWorkspaceId)
  if (!validated.ok) throw new Error(validated.issue.code)
  const configuration: Pick<
    EccPersistedEngineeringSnapshot,
    'workspaceSpec' | 'workspaceBindings'
  > = {}
  for (const field of ['workspaceSpec', 'workspaceBindings'] as const) {
    const value = parsed[field]
    if (value === undefined) continue
    if (!isRecord(value)) throw new Error('ENGINEERING_SNAPSHOT_INVALID')
    configuration[field] = value
  }
  const { qorSnapshotExtension } = validated.sections
  const outputs = stepOutputs(parsed.stepOutputs)
  return {
    ...validated.snapshot,
    ...configuration,
    ...(outputs ? { stepOutputs: outputs } : {}),
    artifacts: readyData(validated.sections.artifacts),
    checklist: readyData(validated.sections.checklist),
    flow: readyData(validated.sections.flow),
    hotspotPreview: readyData(validated.sections.hotspotPreview),
    metrics: readyData(validated.sections.metrics),
    ...(qorSnapshotExtension.status === 'ready'
      ? { qorSnapshotExtension: qorSnapshotExtension.data }
      : {}),
    signoffAssessment: readyData(validated.sections.signoff),
    timingPreview: readyData(validated.sections.timingPreview),
  }
}

export function hasPersistedWorkspace(directory: string): boolean {
  return existsSync(directory)
}
