import { relative, resolve } from 'node:path'
import {
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
  const die = record(parameters.Die)
  const canonicalDie = record(parameters.die_area)
  const core = record(parameters.Core) ?? record(parameters.core)
  const mpc = record(parameters.MPC)
  const template = record(mpc?.core_template)
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
      pdk: stringValue(parameters, 'PDK'),
      design: stringValue(parameters, 'Design'),
      topModule: stringValue(parameters, 'Top module'),
      dieArea: finiteNumber(die?.Area),
      coreUtilization:
        finiteNumber(canonicalDie?.utilitization) ??
        finiteNumber(core?.Utilitization) ??
        finiteNumber(core?.utilitization),
      maxFanout: finiteNumber(parameters['Max fanout']),
      clock: stringValue(parameters, 'Clock'),
      frequencyMaxMhz: finiteNumber(parameters['Frequency max [MHz]']),
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
        if (step.name.toLowerCase().replace(/[\s_-]/g, '') === 'fixfanout') return []
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

function checklistFinding(value: unknown): ChecklistFinding | null {
  const item = record(value)
  if (!item) return null
  const requiredStrings = [
    'id',
    'step',
    'category',
    'owner',
    'policy',
    'state',
    'title',
    'summary',
  ] as const
  if (requiredStrings.some((key) => typeof item[key] !== 'string')) return null
  if (typeof item.blocked !== 'boolean') return null
  const source = record(item.source)
  if (!source || !Array.isArray(item.evidence)) return null
  return {
    id: item.id as string,
    step: item.step as string,
    category: item.category as string,
    owner: item.owner as string,
    policy: item.policy as string,
    state: item.state as string,
    blocked: item.blocked,
    title: item.title as string,
    summary: item.summary as string,
    source,
    evidence: item.evidence.filter(
      (entry): entry is Record<string, unknown> => record(entry) !== null,
    ),
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
    evidence: [
      ...finding.evidence,
      {
        kind: 'flow-checklist-reconciliation',
        previousState: 'failed',
        committedFlowState: 'Success',
      },
    ],
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
  const root = record(snapshot.snapshot.checklist)
  if (!root || !Array.isArray(root.checklist)) {
    return { status: 'error', issues: [{ code: 'WORKSPACE_CHECKLIST_INVALID' }] }
  }
  const findings = root.checklist.map(checklistFinding)
  const invalidCount = findings.filter((finding) => finding === null).length
  const successfulSteps = new Set(
    (flow.status === 'ready' || flow.status === 'partial' ? flow.data.steps : [])
      .filter((step) => step.state === 'succeeded')
      .map((step) => step.name.trim().toLowerCase()),
  )
  const data = {
    findings: findings
      .filter((finding): finding is ChecklistFinding => finding !== null)
      .map((finding) => reconcileFinding(finding, successfulSteps)),
  }
  return invalidCount
    ? {
        status: 'partial',
        data,
        issues: [
          {
            code: 'WORKSPACE_CHECKLIST_ITEM_INVALID',
            detail: `${invalidCount} invalid checklist item(s)`,
          },
        ],
      }
    : { status: 'ready', data, issues: [] }
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
