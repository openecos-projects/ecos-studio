<template>
  <section
    v-if="contract"
    class="my-4 border border-(--border-color) bg-(--bg-secondary)/30 p-4"
  >
    <div class="mb-3 flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-(--text-primary)">{{ contract.title }}</h3>
      <span class="text-xs text-(--text-secondary)">{{ executionState }}</span>
    </div>
    <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-(--text-secondary)">
      <div>
        <dt>Workspace</dt>
        <dd class="break-all text-(--text-primary)">{{ contract.directory }}</dd>
      </div>
      <div>
        <dt>Flow</dt>
        <dd class="text-(--text-primary)">
          {{ contract.flow_config.start_step }} to {{ contract.flow_config.end_step }}
        </dd>
      </div>
      <div>
        <dt>RTL</dt>
        <dd class="break-all text-(--text-primary)">{{ contract.rtl_list[0] }}</dd>
      </div>
      <div>
        <dt>PDK</dt>
        <dd class="break-all text-(--text-primary)">{{ contract.pdk_root }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DesktopAgentWorkspaceSetupContract } from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'

const props = defineProps<{
  contract?: DesktopAgentWorkspaceSetupContract
  createSetupId?: string
}>()
const emit = defineEmits<{
  createWorkspace: [config: WorkspaceConfig, contract: DesktopAgentWorkspaceSetupContract]
}>()

const submittedSetupId = ref('')
const executionState = computed(() =>
  props.createSetupId === props.contract?.setup_id
    ? 'Creating and running'
    : 'Awaiting confirmation',
)

watch(
  [() => props.contract, () => props.createSetupId],
  ([contract, setupId]) => {
    if (
      !contract ||
      !setupId ||
      setupId !== contract.setup_id ||
      submittedSetupId.value === setupId
    )
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
</script>
