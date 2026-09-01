import { computed, ref } from 'vue'
import { getDesktopApi } from '@/platform/desktop'
import type { DesignTool, WorkspaceCreationModel } from '@ecos-studio/shared'

const WIZARD_PARAMETER_IDS = new Set([
  'design.frequency_mhz',
  'floorplan.mode',
  'floorplan.die_width',
  'floorplan.die_height',
  'floorplan.core_util',
  'synth.max_fanout',
])

export function useWorkspaceCreationModel(options: {
  designTool: () => DesignTool | undefined
  flowId: () => string
  inputMode: () => 'rtl' | 'postSynthesis'
  mpc: () => Record<string, unknown> | null
  pdk: () => {
    familyId: string
    mode: 'default' | 'manual'
    version?: string | null
  } | null
  projectPresetParameters: () => Record<string, unknown>
}) {
  const model = ref<WorkspaceCreationModel | null>(null)
  const values = ref<Record<string, unknown>>({})
  const explicitIds = new Set<string>()
  let generation = 0

  const parameters = computed(() =>
    (model.value?.parameters ?? []).filter(
      (parameter) => !WIZARD_PARAMETER_IDS.has(parameter.definition.id),
    ),
  )

  function explicitValues(): Record<string, unknown> {
    return Object.fromEntries(
      [...explicitIds].map((parameterId) => [parameterId, values.value[parameterId]]),
    )
  }

  async function refresh(): Promise<void> {
    if (options.designTool() === 'frontend') return
    const requestGeneration = ++generation
    try {
      const next = await getDesktopApi().workspaceCreationModel.get({
        explicitParameters: explicitValues(),
        flowId: options.flowId(),
        inputMode: options.inputMode(),
        mpc: options.mpc(),
        pdk: options.pdk(),
        projectPresetParameters: options.projectPresetParameters(),
      })
      if (requestGeneration !== generation) return
      model.value = next
      for (const parameter of next.parameters) {
        if (
          values.value[parameter.definition.id] === undefined &&
          parameter.value !== undefined
        ) {
          values.value[parameter.definition.id] = parameter.value
        }
      }
    } catch {
      if (requestGeneration === generation) model.value = null
    }
  }

  function setValue(parameterId: string, value: unknown): void {
    values.value[parameterId] = value
    explicitIds.add(parameterId)
    const parameter = model.value?.parameters.find(
      (candidate) => candidate.definition.id === parameterId,
    )
    if (parameter) parameter.state = 'explicit'
  }

  return { explicitValues, parameters, refresh, setValue, values }
}
