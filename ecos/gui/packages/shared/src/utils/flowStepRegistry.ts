/**
 * Single source of truth for backend (RTL-to-GDS) flow-step identity.
 *
 * One row per canonical step carries every cross-cutting fact the GUI mirrors
 * from the ECC runtime: persisted flow.json names, display label, alias
 * spellings, metric attribution (scope / id prefix), the default tool binding,
 * and shared classifications (layout imagery, signoff gate, structural,
 * skippable, flow-start disabled). Alias maps, label maps, ordering, and
 * classification lists elsewhere in shared/desktop/renderer derive from this
 * table — add or rename a step here (and in ECC `data/types.py` /
 * `tools/ecc/metrics.py`) instead of editing parallel tables.
 *
 * ECC persists its own step names (`Synthesis`, `legalization`, ...); the
 * registry mirrors them in `eccNames` and consistency tests pin the mirror.
 */

export const flowStepCanonicalIds = [
  'Synth',
  'LEC',
  'Floor',
  'Place',
  'CTS',
  'Legal',
  'Timing Opt',
  'Route',
  'Filler',
  'LVS',
  'DRC',
  'Post-route LEC',
  'RCX',
  'STA',
  'Power Analysis',
  'Harden',
] as const

export type ProjectManifestFlowStep = (typeof flowStepCanonicalIds)[number]

export interface FlowStepDefinition {
  /** Canonical GUI step id, e.g. 'Legal'. */
  id: ProjectManifestFlowStep
  /** Persisted flow.json step names in flow order; one entry per family member. */
  eccNames: readonly string[]
  /** Full display label, e.g. 'Legalization'. */
  label: string
  /** Extra spellings that resolve to this step beyond id/label/eccNames. */
  aliases: readonly string[]
  /**
   * Producer `scope` values for this step's metrics (ECC
   * `_metric_scope_and_roles`): the six pinned signoff/final scopes plus the
   * default lowercased step names.
   */
  metricScopes: readonly string[]
  /** Canonical metric ids are namespaced by their emitting step. */
  metricIdPrefixes: readonly string[]
  /** Default tool binding per ECC `rtl2gds/builder.py`. */
  tool: string
  /** Optional check/optimization step a project may exclude from its ledger. */
  skippable?: boolean
  /** Home/step dashboards may present layout imagery for this step. */
  layout?: boolean
  /** Signoff gate step (QoR project gate). */
  gate?: boolean
  /** Structural-change step for db trend jump attribution (filler inserts). */
  structural?: boolean
  /** Step cannot start a flow (LEC self-compare guard). */
  flowStartDisabled?: boolean
}

export const flowStepRegistry: readonly FlowStepDefinition[] = [
  {
    id: 'Synth',
    eccNames: ['Synthesis'],
    label: 'Synthesis',
    aliases: [],
    metricScopes: ['synthesis'],
    metricIdPrefixes: ['synthesis'],
    tool: 'yosys',
  },
  {
    id: 'LEC',
    eccNames: ['lec'],
    label: 'LEC',
    aliases: [],
    metricScopes: ['lec'],
    metricIdPrefixes: [],
    tool: 'yosys_lec',
    skippable: true,
    flowStartDisabled: true,
  },
  {
    id: 'Floor',
    // One canonical step spans the three persisted floorplan-phase steps.
    eccNames: ['preFloorplan', 'macroPlacement', 'postFloorplan'],
    label: 'Floorplan',
    aliases: ['macro', 'macroplace'],
    metricScopes: ['prefloorplan', 'macroplacement', 'postfloorplan', 'floorplan'],
    metricIdPrefixes: [],
    // preFloorplan/postFloorplan run on ecc; macroPlacement runs on dreamplace.
    tool: 'ecc',
    layout: true,
  },
  {
    id: 'Place',
    eccNames: ['place'],
    label: 'Place',
    aliases: ['placement'],
    metricScopes: ['placement'],
    metricIdPrefixes: ['place'],
    tool: 'dreamplace',
    layout: true,
  },
  {
    id: 'CTS',
    eccNames: ['CTS'],
    label: 'CTS',
    aliases: [],
    metricScopes: ['cts'],
    metricIdPrefixes: ['clock', 'cts'],
    tool: 'ecc',
    layout: true,
  },
  {
    id: 'Legal',
    eccNames: ['legalization'],
    label: 'Legalization',
    aliases: [],
    metricScopes: ['legalization'],
    metricIdPrefixes: [],
    tool: 'dreamplace',
    layout: true,
  },
  {
    id: 'Timing Opt',
    eccNames: ['Timing optimization'],
    label: 'Timing Optimization',
    aliases: [],
    metricScopes: ['timing_optimization'],
    metricIdPrefixes: [],
    tool: 'sizer',
    skippable: true,
    layout: true,
  },
  {
    id: 'Route',
    eccNames: ['route'],
    label: 'Route',
    aliases: ['routing'],
    metricScopes: ['final_route'],
    metricIdPrefixes: ['route'],
    tool: 'ecc',
    layout: true,
  },
  {
    id: 'Filler',
    eccNames: ['filler'],
    label: 'Filler',
    aliases: [],
    metricScopes: ['filler'],
    metricIdPrefixes: [],
    tool: 'ecc',
    layout: true,
    structural: true,
  },
  {
    id: 'LVS',
    eccNames: ['lvs'],
    label: 'LVS',
    aliases: [],
    metricScopes: ['final_lvs'],
    metricIdPrefixes: ['lvs'],
    tool: 'ecc',
    layout: true,
    gate: true,
  },
  {
    id: 'DRC',
    eccNames: ['drc'],
    label: 'DRC',
    aliases: [],
    metricScopes: ['final_drc'],
    metricIdPrefixes: ['drc'],
    tool: 'ecc',
    layout: true,
    gate: true,
  },
  {
    id: 'Post-route LEC',
    eccNames: ['postRouteLec'],
    label: 'Post-route LEC',
    aliases: ['postlec'],
    metricScopes: ['postroutelec'],
    metricIdPrefixes: [],
    tool: 'yosys_lec',
    skippable: true,
    flowStartDisabled: true,
  },
  {
    id: 'RCX',
    eccNames: ['RCX'],
    label: 'RCX',
    aliases: [],
    metricScopes: ['signoff_rcx'],
    metricIdPrefixes: ['rcx'],
    tool: 'ecc',
    layout: true,
    gate: true,
    structural: true,
  },
  {
    id: 'STA',
    eccNames: ['sta'],
    label: 'STA',
    aliases: [],
    metricScopes: ['all_configured_corners'],
    metricIdPrefixes: ['sta'],
    tool: 'ecc',
    layout: true,
    gate: true,
  },
  {
    id: 'Power Analysis',
    eccNames: ['powerAnalysis'],
    label: 'Power Analysis',
    aliases: [],
    metricScopes: ['poweranalysis'],
    metricIdPrefixes: [],
    tool: 'ecc',
  },
  {
    id: 'Harden',
    eccNames: ['Harden'],
    label: 'Harden',
    aliases: ['gds', 'signoff'],
    metricScopes: ['final_delivery'],
    metricIdPrefixes: ['harden'],
    tool: 'ecc',
    layout: true,
    structural: true,
  },
]

/** Steps ECC once persisted but the GUI no longer surfaces (removed from flows). */
const OBSOLETE_FLOW_STEP_NAMES = ['fixfanout'] as const

export function normalizeFlowStepName(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
}

/** Normalized-name → canonical id index built from id, label, eccNames, aliases. */
const FLOW_STEP_BY_NAME: ReadonlyMap<string, ProjectManifestFlowStep> = (() => {
  const map = new Map<string, ProjectManifestFlowStep>()
  for (const step of flowStepRegistry) {
    for (const name of [step.id, step.label, ...step.eccNames, ...step.aliases]) {
      const key = normalizeFlowStepName(name)
      if (key) map.set(key, step.id)
    }
  }
  return map
})()

const FLOW_STEP_BY_ID: ReadonlyMap<ProjectManifestFlowStep, FlowStepDefinition> = new Map(
  flowStepRegistry.map((step) => [step.id, step]),
)

export function flowStepDefinition(id: ProjectManifestFlowStep): FlowStepDefinition {
  const definition = FLOW_STEP_BY_ID.get(id)
  if (!definition) throw new Error(`Unknown flow step: ${id}`)
  return definition
}

export function flowStepLabel(id: ProjectManifestFlowStep): string {
  return flowStepDefinition(id).label
}

/**
 * Resolve any known step spelling (canonical id, ECC persisted name, display
 * label, or alias) to the canonical step id. Returns null for unknown input.
 */
export function parseProjectManifestFlowStep(
  step: ProjectManifestFlowStep | string,
): ProjectManifestFlowStep | null {
  if ((flowStepCanonicalIds as readonly string[]).includes(step)) {
    return step as ProjectManifestFlowStep
  }
  return FLOW_STEP_BY_NAME.get(normalizeFlowStepName(step)) ?? null
}

export function normalizeProjectManifestFlowStep(
  step: ProjectManifestFlowStep | string,
): ProjectManifestFlowStep {
  return parseProjectManifestFlowStep(step) ?? 'Synth'
}

export function sameProjectManifestFlowStep(left: string, right: string): boolean {
  const canonical = parseProjectManifestFlowStep(left)
  return canonical !== null && canonical === parseProjectManifestFlowStep(right)
}

/** True for steps ECC once persisted but the GUI no longer surfaces. */
export function isObsoleteFlowStepName(value: string): boolean {
  return OBSOLETE_FLOW_STEP_NAMES.includes(
    normalizeFlowStepName(value) as (typeof OBSOLETE_FLOW_STEP_NAMES)[number],
  )
}

/** True when home/step dashboards may present layout imagery for the step. */
export function isLayoutFlowStep(value: string): boolean {
  const step = parseProjectManifestFlowStep(value)
  return step !== null && flowStepDefinition(step).layout === true
}
