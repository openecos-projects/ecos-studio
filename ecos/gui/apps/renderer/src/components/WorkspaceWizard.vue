<template>
  <FrontendProjectWizard
    v-if="frontendConfig"
    :initial-config="frontendConfig"
    :lock-project-context="frontendConfig.lockProjectContext"
    :lock-workspace-directory="frontendConfig.lockWorkspaceDirectory"
    @close="emit('close')"
    @create="emit('create', $event)"
  />
  <NewProjectWizard
    v-else
    :initial-config="initialConfig"
    :title="title"
    @select-frontend-project="frontendConfig = $event"
    @close="emit('close')"
    @create="emit('create', $event)"
  />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { WorkspaceConfig } from '@/types'
import type { WorkspaceWizardInitialConfig } from '@/utils/workspaceNavigation'
import FrontendProjectWizard from './FrontendProjectWizard.vue'
import NewProjectWizard from './NewProjectWizard.vue'

const props = defineProps<{
  initialConfig?: WorkspaceWizardInitialConfig
  title?: string
}>()
const emit = defineEmits<{
  close: []
  create: [config: WorkspaceConfig]
}>()
const frontendConfig = ref<WorkspaceWizardInitialConfig>()

watch(
  () => props.initialConfig,
  (config) => {
    frontendConfig.value = config?.designTool === 'frontend' ? config : undefined
  },
  { immediate: true },
)
</script>
