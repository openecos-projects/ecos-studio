<template>
  <AgentWorkspaceSetupPanel
    v-if="showSetup"
    :answered-option-id="workspaceSetupAnsweredOptionId"
    :contract="workspaceSetupContract"
    :confirmation-text="workspaceSetupMessage"
    :create-setup-id="workspaceCreateSetupId"
    @create-workspace="onCreateWorkspace"
  />
  <AgentExecutionContractPanel
    v-if="showRerun"
    :answered-option-id="workspaceRerunAnsweredOptionId"
    :confirmation-text="workspaceRerunMessage"
    :execution-state="workspaceRerunExecutionState"
    :rows="workspaceRerunRows"
    :title="workspaceRerunTitle"
  />
  <AgentExecutionContractPanel
    v-if="showContinue"
    :answered-option-id="workspaceContinueAnsweredOptionId"
    :confirmation-text="workspaceContinueMessage"
    :execution-state="workspaceContinueExecutionState"
    :rows="workspaceContinueRows"
    :title="workspaceContinueTitle"
  />
  <AgentExecutionContractPanel
    v-if="showParameter"
    :answered-option-id="workspaceParameterAnsweredOptionId"
    :confirmation-text="workspaceParameterMessage"
    :execution-state="workspaceParameterExecutionState"
    :rows="workspaceParameterRows"
    :title="workspaceParameterTitle"
  />
  <template v-if="showSignoff">
    <AgentExecutionContractPanel
      :answered-option-id="workspaceSignoffAnsweredOptionId"
      :execution-state="workspaceSignoffExecutionState"
      :rows="workspaceSignoffRows"
      :title="workspaceSignoffTitle"
    />
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  DesktopAgentEvent,
  DesktopAgentWorkspaceSetupContract,
} from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import AgentExecutionContractPanel from './AgentExecutionContractPanel.vue'
import AgentWorkspaceSetupPanel from './AgentWorkspaceSetupPanel.vue'

const props = defineProps<{
  isLastTurn?: boolean
  messageId?: string
  mode: 'awaiting' | 'committed'
  workspaceContinueAnsweredOptionId: string
  workspaceContinueAnchorMessageId?: string
  workspaceContinueExecutionState: string
  workspaceContinueMessage: string
  workspaceContinueRows: [string, string][]
  workspaceContinueTitle: string
  workspaceCreateSetupId?: string
  workspaceParameterAnsweredOptionId: string
  workspaceParameterAnchorMessageId?: string
  workspaceParameterExecutionState: string
  workspaceParameterMessage: string
  workspaceParameterRows: [string, string][]
  workspaceParameterTitle: string
  workspaceRerunAnsweredOptionId: string
  workspaceRerunAnchorMessageId?: string
  workspaceRerunExecutionState: string
  workspaceRerunMessage: string
  workspaceRerunRows: [string, string][]
  workspaceRerunTitle: string
  workspaceSignoffAnsweredOptionId: string
  workspaceSignoffAnchorMessageId?: string
  workspaceSignoffExecutionState: string
  workspaceSignoffRows: [string, string][]
  workspaceSignoffTitle: string
  workspaceSetupAnsweredOptionId: string
  workspaceSetupAnchorMessageId?: string
  workspaceSetupContract?: DesktopAgentEvent['workspaceSetup']
  workspaceSetupMessage: string
}>()

const emit = defineEmits<{
  createWorkspace: [config: WorkspaceConfig, contract: DesktopAgentWorkspaceSetupContract]
}>()

const showSetup = computed(() =>
  visibleForMode(
    Boolean(props.workspaceSetupContract),
    props.workspaceSetupAnsweredOptionId,
    props.workspaceSetupAnchorMessageId,
  ),
)
const showRerun = computed(() =>
  visibleForMode(
    Boolean(props.workspaceRerunTitle),
    props.workspaceRerunAnsweredOptionId,
    props.workspaceRerunAnchorMessageId,
  ),
)
const showContinue = computed(() =>
  visibleForMode(
    Boolean(props.workspaceContinueTitle),
    props.workspaceContinueAnsweredOptionId,
    props.workspaceContinueAnchorMessageId,
  ),
)
const showParameter = computed(() =>
  visibleForMode(
    Boolean(props.workspaceParameterTitle),
    props.workspaceParameterAnsweredOptionId,
    props.workspaceParameterAnchorMessageId,
  ),
)
const showSignoff = computed(() =>
  visibleForMode(
    Boolean(props.workspaceSignoffTitle),
    props.workspaceSignoffAnsweredOptionId,
    props.workspaceSignoffAnchorMessageId,
  ),
)

function visibleForMode(
  hasContract: boolean,
  answeredOptionId: string,
  anchorMessageId: string | undefined,
): boolean {
  if (!hasContract) return false
  const committed = Boolean(answeredOptionId)
  if (props.mode === 'awaiting') {
    return !committed && Boolean(props.isLastTurn)
  }
  if (!committed) return false
  return Boolean(anchorMessageId && anchorMessageId === props.messageId)
}

function onCreateWorkspace(
  config: WorkspaceConfig,
  contract: DesktopAgentWorkspaceSetupContract,
): void {
  emit('createWorkspace', config, contract)
}
</script>
