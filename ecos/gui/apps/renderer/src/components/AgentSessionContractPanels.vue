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
  <template v-if="showSignoff">
    <AgentExecutionContractPanel
      :answered-option-id="workspaceSignoffAnsweredOptionId"
      :choice="workspaceSignoffChoice"
      :choice-disabled="choiceDisabled || workspaceSignoffPathInputVisible"
      :execution-state="workspaceSignoffExecutionState"
      :rows="[]"
      :title="workspaceSignoffTitle"
      @select="emit('signoffSelect', $event)"
    />
    <div v-if="workspaceSignoffPathInputVisible" class="signoff-path-editor">
      <label for="signoff-output-path" class="signoff-path-editor__label">
        Signoff package path
      </label>
      <input
        id="signoff-output-path"
        class="signoff-path-editor__input"
        type="text"
        :value="workspaceSignoffOutputPath"
        placeholder="/path/to/signoff_package.tar.gz"
        autocomplete="off"
        @input="emit('signoffPathInput', ($event.target as HTMLInputElement).value)"
      />
      <div class="signoff-path-editor__actions">
        <button
          type="button"
          class="signoff-path-editor__cancel"
          @click="emit('signoffPathCancel')"
        >
          Cancel
        </button>
        <button
          type="button"
          class="signoff-path-editor__confirm"
          :disabled="choiceDisabled || !workspaceSignoffOutputPath.trim()"
          @click="emit('signoffPathConfirm')"
        >
          Export Package
        </button>
      </div>
    </div>
  </template>
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
  workspaceSignoffAnsweredOptionId: string
  workspaceSignoffAnchorTurnId?: string
  workspaceSignoffChoice?: DesktopAgentChoice
  workspaceSignoffExecutionState: string
  workspaceSignoffOutputPath: string
  workspaceSignoffPathInputVisible: boolean
  workspaceSignoffTitle: string
  workspaceSetupAnsweredOptionId: string
  workspaceSetupAnchorTurnId?: string
  workspaceSetupChoice?: DesktopAgentChoice
  workspaceSetupContract?: DesktopAgentEvent['workspaceSetup']
  workspaceSetupMessage: string
}>()

const emit = defineEmits<{
  continueSelect: [option: DesktopAgentChoiceOption]
  createWorkspace: [config: WorkspaceConfig, contract: DesktopAgentWorkspaceSetupContract]
  parameterSelect: [option: DesktopAgentChoiceOption]
  rerunSelect: [option: DesktopAgentChoiceOption]
  signoffSelect: [option: DesktopAgentChoiceOption]
  signoffPathInput: [path: string]
  signoffPathConfirm: []
  signoffPathCancel: []
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
const showSignoff = computed(() =>
  visibleForMode(
    Boolean(props.workspaceSignoffChoice),
    props.workspaceSignoffAnsweredOptionId,
    props.workspaceSignoffAnchorTurnId,
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

<style scoped>
.signoff-path-editor {
  display: grid;
  gap: 0.5rem;
  margin: -0.65rem 0 1rem;
  padding: 0.75rem 1rem 1rem;
  border: 1px solid var(--border-color);
  border-top: 0;
  border-radius: 0 0 0.5rem 0.5rem;
  background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
}

.signoff-path-editor__label {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
}

.signoff-path-editor__input {
  width: 100%;
  min-height: 2.25rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.8125rem;
}

.signoff-path-editor__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.signoff-path-editor__cancel,
.signoff-path-editor__confirm {
  min-height: 2rem;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.signoff-path-editor__cancel {
  background: transparent;
  color: var(--text-secondary);
}

.signoff-path-editor__confirm {
  border-color: var(--accent-color);
  background: var(--accent-color);
  color: white;
}

.signoff-path-editor__confirm:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
