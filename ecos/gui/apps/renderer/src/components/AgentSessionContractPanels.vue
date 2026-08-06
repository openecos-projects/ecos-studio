<template>
  <AgentWorkspaceSetupPanel
    v-if="showSetup"
    :answered-option-id="workspaceSetupAnsweredOptionId"
    :choice="workspaceSetupChoice"
    :choice-disabled="choiceDisabled"
    :contract="workspaceSetupContract"
    :confirmation-text="workspaceSetupMessage"
    :create-setup-id="workspaceCreateSetupId"
    @create-workspace="onCreateWorkspace"
    @select="emit('setupSelect', $event)"
  />
  <AgentExecutionContractPanel
    v-if="showRerun"
    :answered-option-id="workspaceRerunAnsweredOptionId"
    :choice="workspaceRerunChoice"
    :choice-disabled="choiceDisabled"
    :confirmation-text="workspaceRerunMessage"
    :execution-state="workspaceRerunExecutionState"
    :rows="workspaceRerunRows"
    :title="workspaceRerunTitle"
    @select="emit('rerunSelect', $event)"
  />
  <AgentExecutionContractPanel
    v-if="showContinue"
    :answered-option-id="workspaceContinueAnsweredOptionId"
    :choice="workspaceContinueChoice"
    :choice-disabled="choiceDisabled"
    :confirmation-text="workspaceContinueMessage"
    :execution-state="workspaceContinueExecutionState"
    :rows="workspaceContinueRows"
    :title="workspaceContinueTitle"
    @select="emit('continueSelect', $event)"
  />
  <AgentExecutionContractPanel
    v-if="showParameter"
    :answered-option-id="workspaceParameterAnsweredOptionId"
    :choice="workspaceParameterChoice"
    :choice-disabled="choiceDisabled"
    :confirmation-text="workspaceParameterMessage"
    :execution-state="workspaceParameterExecutionState"
    :rows="workspaceParameterRows"
    :title="workspaceParameterTitle"
    @select="emit('parameterSelect', $event)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  DesktopAgentChoice,
  DesktopAgentChoiceOption,
  DesktopAgentEvent,
  DesktopAgentWorkspaceSetupContract,
} from '@ecos-studio/shared'
import type { WorkspaceConfig } from '@/types'
import AgentExecutionContractPanel from './AgentExecutionContractPanel.vue'
import AgentWorkspaceSetupPanel from './AgentWorkspaceSetupPanel.vue'

const props = defineProps<{
  choiceDisabled?: boolean
  isLastTurn?: boolean
  mode: 'awaiting' | 'committed'
  turnId: string
  workspaceContinueAnsweredOptionId: string
  workspaceContinueAnchorTurnId?: string
  workspaceContinueChoice?: DesktopAgentChoice
  workspaceContinueExecutionState: string
  workspaceContinueMessage: string
  workspaceContinueRows: [string, string][]
  workspaceContinueTitle: string
  workspaceCreateSetupId?: string
  workspaceParameterAnsweredOptionId: string
  workspaceParameterAnchorTurnId?: string
  workspaceParameterChoice?: DesktopAgentChoice
  workspaceParameterExecutionState: string
  workspaceParameterMessage: string
  workspaceParameterRows: [string, string][]
  workspaceParameterTitle: string
  workspaceRerunAnsweredOptionId: string
  workspaceRerunAnchorTurnId?: string
  workspaceRerunChoice?: DesktopAgentChoice
  workspaceRerunExecutionState: string
  workspaceRerunMessage: string
  workspaceRerunRows: [string, string][]
  workspaceRerunTitle: string
  workspaceSetupAnsweredOptionId: string
  workspaceSetupAnchorTurnId?: string
  workspaceSetupChoice?: DesktopAgentChoice
  workspaceSetupContract?: DesktopAgentEvent['workspaceSetup']
  workspaceSetupMessage: string
}>()

const emit = defineEmits<{
  continueSelect: [option: DesktopAgentChoiceOption]
  createWorkspace: [
    config: WorkspaceConfig,
    contract: DesktopAgentWorkspaceSetupContract,
  ]
  parameterSelect: [option: DesktopAgentChoiceOption]
  rerunSelect: [option: DesktopAgentChoiceOption]
  setupSelect: [option: DesktopAgentChoiceOption]
}>()

const showSetup = computed(() =>
  visibleForMode(
    Boolean(props.workspaceSetupContract),
    props.workspaceSetupAnsweredOptionId,
    props.workspaceSetupAnchorTurnId,
  ),
)
const showRerun = computed(() =>
  visibleForMode(
    Boolean(props.workspaceRerunTitle),
    props.workspaceRerunAnsweredOptionId,
    props.workspaceRerunAnchorTurnId,
  ),
)
const showContinue = computed(() =>
  visibleForMode(
    Boolean(props.workspaceContinueTitle),
    props.workspaceContinueAnsweredOptionId,
    props.workspaceContinueAnchorTurnId,
  ),
)
const showParameter = computed(() =>
  visibleForMode(
    Boolean(props.workspaceParameterTitle),
    props.workspaceParameterAnsweredOptionId,
    props.workspaceParameterAnchorTurnId,
  ),
)

function visibleForMode(
  hasContract: boolean,
  answeredOptionId: string,
  anchorTurnId: string | undefined,
): boolean {
  if (!hasContract) return false
  const committed = Boolean(answeredOptionId)
  if (props.mode === 'awaiting') {
    return !committed && Boolean(props.isLastTurn)
  }
  if (!committed) return false
  if (anchorTurnId) return anchorTurnId === props.turnId
  return Boolean(props.isLastTurn)
}

function onCreateWorkspace(
  config: WorkspaceConfig,
  contract: DesktopAgentWorkspaceSetupContract,
): void {
  emit('createWorkspace', config, contract)
}
</script>
