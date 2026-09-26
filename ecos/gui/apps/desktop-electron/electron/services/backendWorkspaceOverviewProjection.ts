import { relative, resolve } from 'node:path'
import {
  isObsoleteFlowStepName,
  parseRuntimeSeconds,
  type ChecklistFinding,
  type FlowStepState,
  type EngineeringSnapshotValidationResult,
  type ProjectManifest,
  type ReadSection,
  type WorkspaceChecklistSummary,
  type WorkspaceConfigurationSummary,
  type WorkspaceFlowSummary,
  type WorkspaceOverviewIdentity,
} from '@ecos-studio/shared'

function stringValue(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

function firstStringValue(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = stringValue(record, key)
    if (value) return value
  }
  return ''
}

function firstFiniteNumber(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = finiteNumber(record?.[key])
    if (value !== null) return value
  }
  return null
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return null
  }
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function pathsEqual(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === ''
}

export function configurationSection(
  snapshot: EngineeringSnapshotValidationResult | null,
): ReadSection<WorkspaceConfigurationSummary> {
  if (!snapshot?.ok) {
    return {
      status: 'unavailable',
      issues: [snapshot?.issue ?? { code: 'WORKSPACE_CONFIGURATION_UNAVAILABLE' }],
    }
  }
  const parameters = snapshot.snapshot.parameters
  const die = record(parameters.die) ?? record(parameters.Die)
  const canonicalDie = record(parameters.die_area)
  const core = record(parameters.core) ?? record(parameters.Core)
  const mpc = record(parameters.mpc) ?? record(parameters.MPC)
  const template = record(mpc?.template) ?? record(mpc?.core_template)
  const ports = Array.isArray(template?.ports)
    ? template.ports.flatMap((value) => {
        const port = record(value)
        const name = stringValue(port, 'name').trim()
        return name
          ? [
              {
                name,
                direction: stringValue(port, 'direction').trim() || '--',
                dataType: stringValue(port, 'data_type').trim() || '--',
                width: finiteNumber(port?.width),
                info: stringValue(port, 'info').trim(),
              },
            ]
          : []
      })
    : []
  return {
    status: 'ready',
    data: {
      pdk: firstStringValue(parameters, ['pdk', 'PDK']),
      design: firstStringValue(parameters, ['design', 'Design']),
      topModule: firstStringValue(parameters, ['top_module', 'Top module']),
      dieArea:
        firstFiniteNumber(die, ['area', 'Area']) ??
        firstFiniteNumber(canonicalDie, ['area', 'Area']) ??
        finiteNumber(parameters.die_area),
      coreUtilization:
        firstFiniteNumber(canonicalDie, ['utilization', 'utilitization']) ??
        firstFiniteNumber(core, ['utilization', 'utilitization', 'Utilitization']) ??
        finiteNumber(parameters.core_utilization),
      maxFanout: firstFiniteNumber(parameters, ['max_fanout', 'Max fanout']),
      clock: firstStringValue(parameters, ['clock', 'Clock']),
      frequencyMaxMhz: firstFiniteNumber(parameters, [
        'frequency_max',
        'Frequency max [MHz]',
      ]),
      mpcDisplayName: stringValue(mpc, 'display_name').trim() || null,
      mpcConstraints: template
        ? {
            minimumArea: finiteNumber(template.minimum_area),
            maximumArea: finiteNumber(template.maximum_area),
            maximumCellCount: finiteNumber(template.maximum_cell_num),
            ports,
          }
        : null,
    },
    issues: [],
  }
}

function normalizeFlowState(value: string): FlowStepState {
  switch (value.trim().toLowerCase()) {
    case 'success':
    case 'succeeded':
    case 'completed':
    case 'complete':
      return 'succeeded'
    case 'warning':
      return 'warning'
    case 'ongoing':
    case 'running':
      return 'running'
    case 'incomplete':
    case 'invalid':
    case 'failed':
    case 'failure':
    case 'error':
      return 'failed'
    case 'pending':
    case 'unstart':
    case 'unstarted':
    case 'not_started':
    case 'not-started':
    case 'not started':
      return 'not-started'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return value.trim() ? 'unknown' : 'not-started'
  }
}

export function flowSection(
  snapshot: EngineeringSnapshotValidationResult | null,
): ReadSection<WorkspaceFlowSummary> {
  if (!snapshot?.ok) {
    return {
      status: 'unavailable',
      issues: [snapshot?.issue ?? { code: 'WORKSPACE_FLOW_UNAVAILABLE' }],
    }
  }
  const flow = snapshot.sections.flow
  if (flow.status !== 'ready' && flow.status !== 'partial') {
    return { status: flow.status, issues: flow.issues }
  }
  const steps = record(flow.data)?.steps
  if (!Array.isArray(steps)) {
    return { status: 'error', issues: [{ code: 'WORKSPACE_FLOW_INVALID' }] }
  }
  return {
    status: 'ready',
    data: {
      steps: steps.flatMap((value, order) => {
        const step = record(value)
        if (!step || typeof step.name !== 'string') return []
        if (isObsoleteFlowStepName(step.name)) return []
        const runtimeSeconds = parseRuntimeSeconds(String(step.runtime ?? ''))
        const peakMemoryMb = finiteNumber(
          step['peak memory (mb)'] ?? record(step.info)?.['peak memory (mb)'],
        )
        return [
          {
            stepId: step.name,
            order,
            name: step.name,
            state: normalizeFlowState(String(step.state ?? '')),
            ...(typeof step.tool === 'string' && step.tool ? { toolId: step.tool } : {}),
            ...(runtimeSeconds === null ? {} : { runtimeSeconds }),
            ...(peakMemoryMb === null ? {} : { peakMemoryMb }),
          },
        ]
      }),
    },
    issues: [],
  }
}

function checklistFinding(item: {
  id: string
  title: string
  state: string
  blocked: boolean
  step: string
  category: string
  summary: string
}): ChecklistFinding {
  // The v6 checklist projection carries display fields only; evidence and
  // source stay in the workspace checklist.json and load through the artifact
  // channel on demand.
  return {
    id: item.id,
    step: item.step,
    category: item.category,
    state: item.state,
    blocked: item.blocked,
    title: item.title,
    summary: item.summary,
  }
}

function reconcileFinding(
  finding: ChecklistFinding,
  successfulSteps: ReadonlySet<string>,
): ChecklistFinding {
  if (
    finding.category !== 'flow' ||
    finding.state !== 'failed' ||
    !successfulSteps.has(finding.step.trim().toLowerCase())
  ) {
    return finding
  }
  return {
    ...finding,
    blocked: false,
    state: 'pass',
    reconciled: {
      previousState: 'failed',
      committedFlowState: 'Success',
    },
  }
}

export function checklistSection(
  snapshot: EngineeringSnapshotValidationResult | null,
  flow: ReadSection<WorkspaceFlowSummary>,
): ReadSection<WorkspaceChecklistSummary> {
  if (!snapshot?.ok) {
    return {
      status: 'unavailable',
      issues: [snapshot?.issue ?? { code: 'WORKSPACE_CHECKLIST_UNAVAILABLE' }],
    }
  }
  const section = snapshot.sections.checklist
  if (section.status !== 'ready' && section.status !== 'partial') {
    return { status: 'error', issues: [{ code: 'WORKSPACE_CHECKLIST_INVALID' }] }
  }
  const successfulSteps = new Set(
    (flow.status === 'ready' || flow.status === 'partial' ? flow.data.steps : [])
      .filter((step) => step.state === 'succeeded')
      .map((step) => step.name.trim().toLowerCase()),
  )
  return {
    status: 'ready',
    data: {
      findings: section.data.items.map((item) =>
        reconcileFinding(checklistFinding(item), successfulSteps),
      ),
    },
    issues: [],
  }
}

export function identityFromManifest(
  workspaceRoot: string,
  manifest: ProjectManifest | null,
): WorkspaceOverviewIdentity {
  const workspace = manifest?.workspaces.find((candidate) =>
    pathsEqual(candidate.workspace_path, workspaceRoot),
  )
  return {
    ...(manifest ? { projectId: manifest.project_id, projectName: manifest.name } : {}),
    ...(workspace
      ? { workspaceId: workspace.workspace_id, workspaceName: workspace.name }
      : {
          workspaceName:
            workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? 'Workspace',
        }),
    ...(manifest?.qor_baseline?.workspace_id
      ? { baselineWorkspaceId: manifest.qor_baseline.workspace_id }
      : {}),
  }
}
