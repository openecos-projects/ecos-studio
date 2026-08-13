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
  <div v-if="contract" class="agent-mpc-choice">
    <label class="agent-mpc-choice__label">
      <input
        v-model="useMpc"
        type="checkbox"
        :disabled="mpcLoading || Boolean(createSetupId) || !selectedMpc"
      />
      Use a SoC-MPC template for this workspace
    </label>
    <p v-if="mpcLoading" class="agent-mpc-choice__status">
      Loading available templates...
    </p>
    <p v-else-if="!selectedMpc" class="agent-mpc-choice__status">
      No usable SoC-MPC template is selected.
    </p>
    <label v-if="mpcCandidates.length" class="agent-mpc-choice__select">
      <span>Template</span>
      <select v-model="selectedMpcResourceId" :disabled="Boolean(createSetupId)">
        <option
          v-for="candidate in mpcCandidates"
          :key="candidate.resource_id"
          :value="candidate.resource_id"
        >
          {{ candidate.display_name }} ({{ candidate.installed_version }})
        </option>
      </select>
    </label>
    <label v-if="mpcDesigns.length > 1" class="agent-mpc-choice__select">
      <span>Design</span>
      <select v-model="selectedMpcDesignIndex" :disabled="Boolean(createSetupId)">
        <option v-for="design in mpcDesigns" :key="design.index" :value="design.index">
          {{ design.designName }}
        </option>
      </select>
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
import { listResourcesApi, readMpcSpecApi } from '@/api/plugin'
import type {
  ProjectManifestMpc,
  ProjectManifestMpcCandidate,
} from '@/utils/projectManagement'
import { parseProjectManifest } from '@/utils/projectManagement'
import { readProjectManagementManifest } from '@/utils/projectManagementRead'
import {
  createProjectManifestMpcSnapshot,
  parseMpcSpecDesigns,
  type MpcSpecDesign,
} from '@/utils/mpcSpec'
import { projectMpcOptionFromResource } from '@/utils/projectManagement'
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
const mpcCandidates = ref<ProjectManifestMpcCandidate[]>([])
const selectedMpcResourceId = ref('')
const mpcDesigns = ref<MpcSpecDesign[]>([])
const selectedMpcDesignIndex = ref<number | null>(null)
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
    mpcCandidates.value = []
    mpcDesigns.value = []
    selectedMpcResourceId.value = selectedMpc.value?.resource_id ?? ''
    selectedMpcDesignIndex.value = selectedMpc.value?.design.index ?? null
    if (!projectRoot) return
    mpcLoading.value = true
    try {
      let content: string | null = null
      try {
        content = await readProjectManagementManifest(projectRoot)
      } catch {
        // A new project has no manifest yet; installed MPC resources are still selectable.
      }
      if (content && !props.contract?.mpc) {
        try {
          selectedMpc.value = parseProjectManifest(content).mpc
          useMpc.value = Boolean(selectedMpc.value)
        } catch {
          // An invalid project manifest must not hide otherwise usable MPC resources.
        }
      }
      selectedMpcResourceId.value = selectedMpc.value?.resource_id ?? ''
      if (!selectedMpc.value) {
        try {
          const resources = await listResourcesApi()
          mpcCandidates.value = resources.flatMap((resource) => {
            const candidate = projectMpcOptionFromResource(resource)
            return candidate ? [candidate] : []
          })
          if (mpcCandidates.value[0]) {
            selectedMpcResourceId.value = mpcCandidates.value[0].resource_id
            await loadMpcDesigns(mpcCandidates.value[0])
          }
        } catch {
          mpcCandidates.value = []
        }
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

watch(selectedMpcResourceId, async (resourceId) => {
  if (!resourceId || selectedMpc.value?.resource_id === resourceId) return
  const candidate = mpcCandidates.value.find((item) => item.resource_id === resourceId)
  if (!candidate) return
  mpcLoading.value = true
  try {
    await loadMpcDesigns(candidate)
  } finally {
    mpcLoading.value = false
  }
})

watch(selectedMpcDesignIndex, (index) => {
  const candidate = mpcCandidates.value.find(
    (item) => item.resource_id === selectedMpcResourceId.value,
  )
  const design = mpcDesigns.value.find((item) => item.index === index)
  if (candidate && design) {
    selectedMpc.value = createProjectManifestMpcSnapshot(candidate, design)
  }
})

async function loadMpcDesigns(candidate: ProjectManifestMpcCandidate): Promise<void> {
  const result = await readMpcSpecApi(candidate.resource_id)
  mpcDesigns.value = parseMpcSpecDesigns(result.spec)
  selectedMpcDesignIndex.value = mpcDesigns.value[0]?.index ?? null
  const design = mpcDesigns.value[0]
  if (design) selectedMpc.value = createProjectManifestMpcSnapshot(candidate, design)
}

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
