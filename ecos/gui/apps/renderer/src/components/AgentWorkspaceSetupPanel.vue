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
  <div v-if="contract && (mpcLoading || selectedMpc)" class="agent-mpc-choice">
    <label class="agent-mpc-choice__label">
      <input v-model="useMpc" type="checkbox" :disabled="mpcLoading || Boolean(createSetupId)" />
      Use the Project's SoC-MPC template for this workspace
    </label>
    <p v-if="useMpc && selectedMpc" class="agent-mpc-choice__summary">
      {{ selectedMpc.display_name }} / {{ selectedMpc.design.design_name }}
      <span>{{ selectedMpc.spec_path }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DesktopAgentChoice,
  DesktopAgentChoiceOption,
  DesktopAgentWorkspaceSetupContract,
} from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import type { ProjectManifestMpc } from '@/utils/projectManagement'
import { parseProjectManifest } from '@/utils/projectManagement'
import { readProjectManagementManifest } from '@/utils/projectManagementRead'
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
const selectedMpc = ref<ProjectManifestMpc | null>(null)
const useMpc = ref(false)
const mpcLoading = ref(false)
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
  const contract = props.contract
  if (!contract) return ''
  const workspaceName = leafName(contract.directory)
  const design = contract.parameters.design
  const flow = `${contract.flow_config.start_step} to ${contract.flow_config.end_step}`
  return [workspaceName, design, flow].filter(Boolean).join(' · ')
})
const specRows = computed<[string, string][]>(() => {
  const contract = props.contract
  if (!contract) return []
  const parameters = contract.parameters
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
    ['Description', optionalValue(parameters.description)],
    ['Requires GUI Review', String(contract.requires_gui_review)],
    ['Setup ID', contract.setup_id],
    ['Schema Version', contract.schema_version],
  ]
})

watch(
  () => props.contract?.project_context.project_root,
  async (projectRoot) => {
    selectedMpc.value = props.contract?.mpc ?? null
    useMpc.value = Boolean(selectedMpc.value)
    if (!projectRoot) return
    mpcLoading.value = true
    try {
      const content = await readProjectManagementManifest(projectRoot)
      if (content && !props.contract?.mpc) {
        selectedMpc.value = parseProjectManifest(content).mpc
        useMpc.value = Boolean(selectedMpc.value)
      }
    } catch {
      selectedMpc.value = props.contract?.mpc ?? null
      useMpc.value = Boolean(selectedMpc.value)
    } finally {
      mpcLoading.value = false
    }
  },
  { immediate: true },
)

watch(
  [() => props.contract, () => props.createSetupId, () => mpcLoading.value],
  ([contract, setupId]) => {
    if (!setupId) {
      submittedSetupId.value = ''
      return
    }
    if (
      !contract ||
      mpcLoading.value ||
      setupId !== contract.setup_id ||
      submittedSetupId.value === setupId
    )
      return
    submittedSetupId.value = setupId
    const selectedMpcValue = useMpc.value ? selectedMpc.value : null
    const selectedParameters = { ...contract.parameters } as typeof contract.parameters &
      Record<string, unknown>
    if (selectedMpcValue) selectedParameters.MPC = selectedMpcValue
    else delete selectedParameters.MPC
    const selectedContract = {
      ...contract,
      mpc: selectedMpcValue,
      parameters: selectedParameters,
    }
    const config = workspaceConfig(selectedContract)
    emit('createWorkspace', config, selectedContract)
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
