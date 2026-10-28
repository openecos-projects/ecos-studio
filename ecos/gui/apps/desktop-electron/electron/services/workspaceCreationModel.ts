import {
  parseProjectManifestFlowStep,
  type PdkInstallationSnapshot,
  type WorkspaceCreationModel,
  type WorkspaceCreationModelRequest,
} from '@ecos-studio/shared'

export function buildWorkspaceCreationModel(
  discovery: Record<string, unknown>,
  pdkInstallations: PdkInstallationSnapshot[],
  request: WorkspaceCreationModelRequest = {},
): WorkspaceCreationModel {
  const catalog = Array.isArray(discovery.parameterCatalog)
    ? discovery.parameterCatalog.filter(isRecord)
    : []
  const applicableSteps = flowSteps(discovery, request.flowId)
  const model: WorkspaceCreationModel = {
    controls: {
      flowBoundaries: true,
      manualPdkFiles: true,
      mpc: true,
      pdkVersion: true,
    },
    context: {
      ...(request.flowId ? { flowId: request.flowId } : {}),
      ...(request.inputMode ? { inputMode: request.inputMode } : {}),
      mpc: request.mpc ?? null,
      pdk: request.pdk ?? null,
    },
    discovery,
    parameters: catalog.flatMap((definition) => {
      if (typeof definition.id !== 'string') return []
      const hasExplicit = Object.hasOwn(request.explicitParameters ?? {}, definition.id)
      const hasProjectPreset = Object.hasOwn(
        request.projectPresetParameters ?? {},
        definition.id,
      )
      const explicit = request.explicitParameters?.[definition.id]
      const preset = request.projectPresetParameters?.[definition.id]
      const appliesTo =
        typeof definition.appliesTo === 'string'
          ? normalizeStep(definition.appliesTo)
          : ''
      const applicable = !applicableSteps || !appliesTo || applicableSteps.has(appliesTo)
      return [
        {
          definition: definition as Record<string, unknown> & { id: string },
          state: applicable
            ? hasExplicit
              ? ('explicit' as const)
              : ('defaulted' as const)
            : ('inapplicable' as const),
          ...(applicable
            ? {
                source: hasExplicit
                  ? ('user' as const)
                  : hasProjectPreset
                    ? ('projectPreset' as const)
                    : ('catalogDefault' as const),
                value: hasExplicit
                  ? explicit
                  : hasProjectPreset
                    ? preset
                    : definition.default,
              }
            : { inapplicableReason: `flow:${request.flowId}` }),
        },
      ]
    }),
    pdkInstallations,
  }
  applyStaCornerLimit(model)
  return model
}

function applyStaCornerLimit(model: WorkspaceCreationModel): void {
  const parallel = model.parameters.find(
    (parameter) => parameter.definition.id === 'sta.max_parallel_corners',
  )
  const signoff = model.parameters.find(
    (parameter) => parameter.definition.id === 'sta.signoff',
  )?.value
  if (!parallel || !Array.isArray(signoff)) return
  const cornerCount = signoff
    .filter(isRecord)
    .reduce(
      (total, group) =>
        total +
        Object.values(group).reduce<number>(
          (count, corners) => count + (Array.isArray(corners) ? corners.length : 0),
          0,
        ),
      0,
    )
  const range = parallel.definition.range
  const catalogMaximum = Array.isArray(range) ? range[1] : null
  const maximum =
    typeof catalogMaximum === 'number' && Number.isSafeInteger(catalogMaximum)
      ? Math.min(cornerCount, catalogMaximum)
      : cornerCount
  parallel.definition = { ...parallel.definition, range: [1, Math.max(1, maximum)] }
}

function flowSteps(
  discovery: Record<string, unknown>,
  flowId: string | undefined,
): Set<string> | null {
  if (!flowId || !Array.isArray(discovery.flowDefinitions)) return null
  const flow = discovery.flowDefinitions
    .filter(isRecord)
    .find((candidate) => candidate.flowId === flowId)
  if (!flow || !Array.isArray(flow.stepIds)) return new Set()
  return new Set(
    flow.stepIds
      .filter((step): step is string => typeof step === 'string')
      .map(normalizeStep),
  )
}

function normalizeStep(step: string): string {
  return parseProjectManifestFlowStep(step) ?? step.trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
