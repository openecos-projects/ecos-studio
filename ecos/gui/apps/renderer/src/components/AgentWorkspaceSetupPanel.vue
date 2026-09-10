<template>
  <AgentExecutionContractPanel
    :answered-option-id="answeredOptionId"
    :choice="choice"
    :choice-disabled="choiceDisabled || !canConfirmTopModule"
    :confirmation-text="confirmationText"
    :execution-state="executionState"
    :rows="specRows"
    :summary="committedSummary"
    :title="displayTitle"
    @select="emit('select', $event)"
  >
    <template #before-choice>
      <TopModuleField
        v-if="executionState === 'Review'"
        v-model="confirmedTopModule"
        :allow-free-text="topModuleAllowsFreeText"
        :candidates="topModuleCandidates"
        :message="topModuleMessage"
        :suggested="topModuleSuggested"
      />
    </template>
  </AgentExecutionContractPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DesktopAgentChoice,
  DesktopAgentChoiceOption,
  DesktopAgentWorkspaceSetupContract,
  HdlModuleDiscoveryResult,
} from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import { getDesktopApi } from '@/platform/desktop'
import { displayAgentContractTitle } from './agentContractDisplay'
import AgentExecutionContractPanel from './AgentExecutionContractPanel.vue'
import TopModuleField from './TopModuleField.vue'
import {
  canSubmitTopModule,
  exclusiveRtlFilelistPrefill,
  topModuleBlockedReason,
} from './topModuleConfirmation'

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
const confirmedTopModule = ref('')
const topModuleDiscovery = ref<HdlModuleDiscoveryResult | null>(null)
let topModuleDiscoveryToken = 0
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
    ['Top Module', confirmedTopModule.value || parameters.top_module || '-'],
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

const topModuleCandidates = computed(() => topModuleDiscovery.value?.candidates ?? [])
const topModuleSuggested = computed(() => topModuleDiscovery.value?.suggested ?? '')
const topModuleAllowsFreeText = computed(() => {
  const status = topModuleDiscovery.value?.status
  return status === 'incomplete' || status === 'total_read_failure'
})
const topModuleMessage = computed(() => topModuleBlockedReason(topModuleDiscovery.value))
const canConfirmTopModule = computed(() =>
  canSubmitTopModule(topModuleDiscovery.value, confirmedTopModule.value),
)

watch(
  [() => props.contract, () => props.createSetupId, canConfirmTopModule],
  ([contract, setupId]) => {
    if (!setupId) {
      submittedSetupId.value = ''
      return
    }
    if (!contract || setupId !== contract.setup_id || submittedSetupId.value === setupId)
      return
    if (!canConfirmTopModule.value) return
    submittedSetupId.value = setupId
    emit('createWorkspace', workspaceConfig(contract), contract)
  },
  { immediate: true },
)

watch(
  () => props.contract,
  (contract) => {
    confirmedTopModule.value = contract?.parameters.top_module ?? ''
    void refreshTopModuleDiscovery()
  },
  { immediate: true },
)

async function refreshTopModuleDiscovery() {
  const contract = props.contract
  const requestToken = ++topModuleDiscoveryToken
  if (!contract) {
    topModuleDiscovery.value = null
    return
  }
  try {
    const result = await getDesktopApi().workspace.discoverHdlModules(
      contract.filelist
        ? {
            designName: contract.parameters.design,
            filelistPath: contract.filelist,
          }
        : {
            designName: contract.parameters.design,
            rtlPaths: contract.rtl_list,
          },
    )
    if (requestToken !== topModuleDiscoveryToken) return
    topModuleDiscovery.value = result
    if (result.status === 'complete' && result.candidates.length > 0) {
      confirmedTopModule.value = result.candidates.includes(confirmedTopModule.value)
        ? confirmedTopModule.value
        : result.suggested
    }
  } catch (error) {
    if (requestToken !== topModuleDiscoveryToken) return
    topModuleDiscovery.value = {
      candidates: [],
      reason: error instanceof Error ? error.message : 'HDL discovery failed.',
      status: 'total_read_failure',
      suggested: '',
    }
  }
}

function workspaceConfig(contract: DesktopAgentWorkspaceSetupContract): WorkspaceConfig {
  const exclusive = exclusiveRtlFilelistPrefill(
    contract.rtl_list,
    contract.filelist ?? '',
  )
  return {
    design_input_mode: 'rtl',
    directory: contract.directory,
    filelist: exclusive.filelist || undefined,
    flow_config: contract.flow_config,
    origin_def: '',
    origin_verilog: '',
    parameters: { ...contract.parameters, top_module: confirmedTopModule.value },
    pdk: contract.pdk,
    pdk_config: contract.pdk_config,
    pdk_config_mode: contract.pdk_config_mode,
    pdk_root: contract.pdk_root,
    project_context: contract.project_context,
    rtl_list: exclusive.rtlList,
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
