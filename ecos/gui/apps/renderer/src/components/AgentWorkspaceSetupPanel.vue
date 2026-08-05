<template>
  <AgentExecutionContractPanel
    :answered-option-id="answeredOptionId"
    :choice="choice"
    :choice-disabled="choiceDisabled"
    :confirmation-text="confirmationText"
    :execution-state="executionState"
    :rows="specRows"
    :title="contract?.title ?? ''"
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
const executionState = computed(() =>
  props.createSetupId === props.contract?.setup_id
    ? 'Creating and running'
    : 'Awaiting confirmation',
)
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
    ['Die Width', optionalValue(parameters.die_width)],
    ['Die Height', optionalValue(parameters.die_height)],
    ['Target Density', String(parameters.target_density)],
    ['Target Overflow', String(parameters.target_overflow)],
    ['Description', optionalValue(parameters.description)],
    ['Requires GUI Review', String(contract.requires_gui_review)],
    ['Setup ID', contract.setup_id],
    ['Schema Version', contract.schema_version],
  ]
})

watch(
  [() => props.contract, () => props.createSetupId],
  ([contract, setupId]) => {
    if (!setupId) {
      submittedSetupId.value = ''
      return
    }
    if (!contract || setupId !== contract.setup_id || submittedSetupId.value === setupId)
      return
    submittedSetupId.value = setupId
    emit('createWorkspace', workspaceConfig(contract), contract)
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
  return parts.at(-1) || path
}
</script>
