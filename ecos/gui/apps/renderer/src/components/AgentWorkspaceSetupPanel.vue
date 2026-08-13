<template>
  <AgentExecutionContractPanel
    :answered-option-id="answeredOptionId"
    :choice="choice"
    :choice-disabled="choiceDisabled"
    :confirmation-text="confirmationText"
    :execution-state="executionState"
    :rows="specRows"
    :summary="committedSummary"
    :title="displayTitle"
    @select="emit('select', $event)"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DesktopAgentChoice,
  DesktopAgentChoiceOption,
  DesktopAgentWorkspaceSetupContract,
} from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { installResourceApi, listResourcesApi, readMpcSpecApi } from '@/api/plugin'
import { projectMpcOptionFromResource } from '@/utils/projectManagement'
import type { ProjectManifestMpc } from '@/utils/projectManagement'
import { createProjectManifestMpcSnapshot, parseMpcSpecDesigns } from '@/utils/mpcSpec'
import { displayAgentContractTitle } from './agentContractDisplay'
import AgentExecutionContractPanel from './AgentExecutionContractPanel.vue'

const props = defineProps<{
  answeredOptionId?: string
  choice?: DesktopAgentChoice
  choiceDisabled?: boolean
  contract?: DesktopAgentWorkspaceSetupContract
  confirmationText?: string
  createSetupId?: string
}>()
const emit = defineEmits<{
  createWorkspace: [config: WorkspaceConfig, contract: DesktopAgentWorkspaceSetupContract]
  select: [option: DesktopAgentChoiceOption]
}>()

const submittedSetupId = ref('')
const resolvedContract = ref<DesktopAgentWorkspaceSetupContract>()
const mpcLoading = ref(false)
// ponytail: bounded install polling; replace with resource progress events if installs exceed 30s.
const MPC_RESOLUTION_ATTEMPTS = 60
const MPC_RESOLUTION_DELAY_MS = 500
const displayTitle = computed(() =>
  displayAgentContractTitle(props.contract?.title ?? ''),
)
const answeredOption = computed(() =>
  props.choice?.options.find((option) => option.id === props.answeredOptionId),
)
const isCancelled = computed(
  () =>
    answeredOption.value?.value === '2' ||
    /cancel/i.test(answeredOption.value?.label ?? ''),
)
const executionState = computed(() => {
  if (props.createSetupId === props.contract?.setup_id) return 'Running'
  if (!props.answeredOptionId) return 'Review'
  if (isCancelled.value) return 'Cancelled'
  return 'Confirmed'
})
const committedSummary = computed(() => {
  const contract = resolvedContract.value
  if (!contract) return ''
  const workspaceName = leafName(contract.directory)
  const design = contract.parameters.design
  const flow = `${contract.flow_config.start_step} to ${contract.flow_config.end_step}`
  return [workspaceName, design, flow].filter(Boolean).join(' · ')
})
const specRows = computed<[string, string][]>(() => {
  const contract = resolvedContract.value
  if (!contract) return []
  const parameters = contract.parameters
  const mpc = contract.mpc
  const workspaceName = leafName(contract.directory)
  return [
    ['Project Root', contract.project_context.project_root],
    ['Project Name', contract.project_context.project_name],
    ['Workspace', contract.directory],
    ['Workspace Name', workspaceName],
    ['Design Name', parameters.design],
    ['Flow', `${contract.flow_config.start_step} to ${contract.flow_config.end_step}`],
    ['Flow Steps', contract.flow_config.steps.join(' to ')],
    ['RTL', contract.rtl_list[0] ?? '-'],
    ['Filelist', contract.filelist ?? '-'],
    ['SDC', contract.sdc ?? '-'],
    ['Design Input Mode', contract.design_input_mode],
    ['PDK', contract.pdk],
    ['PDK Root', contract.pdk_root],
    ['PDK Config Mode', contract.pdk_config_mode],
    ['Top Module', parameters.top_module],
    ['Clock', parameters.clock],
    ['Frequency Max (MHz)', String(parameters.frequency_max)],
    ['Max Fanout', String(parameters.max_fanout)],
    ['Die Area Mode', parameters.die_area_mode],
    ['Utilization', optionalValue(parameters.utilitization)],
    ['Margin', String(parameters.margin)],
    ['Target Density', String(parameters.target_density)],
    ['Target Overflow', String(parameters.target_overflow)],
    ['Use SoC-MPC', contract.mpc_enabled ? 'Yes' : 'No'],
    ['SoC-MPC Template', mpc?.display_name ?? '-'],
    ['SoC-MPC Design', mpc?.design.design_name ?? '-'],
    ['SoC-MPC Spec', mpc?.spec_path ?? '-'],
    ['Description', optionalValue(parameters.description)],
    ['Requires GUI Review', String(contract.requires_gui_review)],
    ['Setup ID', contract.setup_id],
    ['Schema Version', contract.schema_version],
  ]
})

watch(
  [() => props.contract, () => props.createSetupId, () => mpcLoading.value],
  async ([contract, setupId]) => {
    if (contract && resolvedContract.value?.setup_id !== contract.setup_id) {
      resolvedContract.value = contract
      if (contract.mpc_enabled && !contract.mpc) await resolveMpc(contract)
    }
    if (!setupId) {
      submittedSetupId.value = ''
      return
    }
    if (
      !resolvedContract.value ||
      mpcLoading.value ||
      setupId !== resolvedContract.value.setup_id ||
      submittedSetupId.value === setupId
    )
      return
    submittedSetupId.value = setupId
    const config = workspaceConfig(resolvedContract.value)
    emit('createWorkspace', config, resolvedContract.value)
  },
  { immediate: true },
)

async function resolveMpc(contract: DesktopAgentWorkspaceSetupContract): Promise<void> {
  mpcLoading.value = true
  try {
    let resources = await listResourcesApi()
    let candidate = resources
      .map(projectMpcOptionFromResource)
      .find((item): item is NonNullable<typeof item> => item !== null)
    if (!candidate) {
      const downloadable = resources.find(
        (resource) =>
          resource.type === 'mpc' &&
          resource.actions.includes('install') &&
          resource.available_versions.length > 0,
      )
      if (downloadable) {
        await installResourceApi(downloadable.id, downloadable.available_versions[0])
        for (
          let attempt = 0;
          attempt < MPC_RESOLUTION_ATTEMPTS && !candidate;
          attempt += 1
        ) {
          if (attempt > 0) await delay(MPC_RESOLUTION_DELAY_MS)
          resources = await listResourcesApi()
          candidate = resources
            .map(projectMpcOptionFromResource)
            .find((item): item is NonNullable<typeof item> => item !== null)
        }
      }
    }
    if (!candidate) return
    const result = await readMpcSpecApi(candidate.resource_id)
    const design = parseMpcSpecDesigns(result.spec)[0]
    if (!design) return
    const mpc: ProjectManifestMpc = createProjectManifestMpcSnapshot(candidate, design)
    const parameters = { ...contract.parameters, MPC: mpc }
    resolvedContract.value = { ...contract, mpc, parameters }
  } catch {
    // No usable installed resource: keep the explicit Use choice and allow creation.
  } finally {
    mpcLoading.value = false
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/*
 * The contract is frozen before this component receives it; only the selected
 * resource snapshot is enriched locally before the create event is emitted.
 */
watch(
  () => props.contract,
  (contract) => {
    if (!contract) resolvedContract.value = undefined
  },
  { immediate: true },
)

function workspaceConfig(contract: DesktopAgentWorkspaceSetupContract): WorkspaceConfig {
  return {
    design_input_mode: 'rtl',
    directory: contract.directory,
    filelist: contract.filelist,
    flow_config: contract.flow_config,
    origin_def: '',
    origin_verilog: '',
    parameters: { ...contract.parameters },
    mpc: contract.mpc ?? null,
    pdk: contract.pdk,
    pdk_config: contract.pdk_config,
    pdk_config_mode: contract.pdk_config_mode,
    pdk_root: contract.pdk_root,
    project_context: contract.project_context,
    rtl_list: [...contract.rtl_list],
    sdc: contract.sdc,
  }
}

function optionalValue(value: string | number | undefined): string {
  return value === undefined || value === '' ? '-' : String(value)
}

function leafName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || path
}
</script>
