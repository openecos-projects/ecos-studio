<template>
  <div class="flow-run-control" :class="{ 'flow-step-actions': showStepActions }">
    <button
      type="button"
      :class="
        showStepActions
          ? 'flow-run-dialog-button is-primary'
          : 'flow-run-icon-button flow-run-start-button'
      "
      :aria-busy="flowRunControlBusy"
      :disabled="flowRunControlDisabled"
      :title="runButtonLabel"
      :aria-label="runButtonLabel"
      @click="handleRunRequest"
    >
      <i
        :class="flowRunControlBusy ? 'ri-loader-4-line animate-spin' : 'ri-play-fill'"
        aria-hidden="true"
      />
      <span v-if="showStepActions">{{ runButtonLabel }}</span>
    </button>
    <button
      v-if="showStepActions && props.step"
      type="button"
      class="flow-run-dialog-button"
      :disabled="flowRunControlDisabled"
      @click="requestFromStep"
    >
      Run from this step
    </button>
  </div>

  <Dialog
    v-model:visible="rerunConfirmationVisible"
    modal
    :header="runFromStep ? 'Run from this step?' : `Run ${runTargetLabel} again?`"
    :style="{ width: 'min(420px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <p class="flow-run-dialog-copy">
      {{
        runFromStep
          ? `Run ${runTargetLabel} and the later steps in this workspace. This replaces any existing results for those steps.`
          : `Running ${runTargetLabel} again will replace its current execution results.`
      }}
    </p>
    <div class="flow-run-dialog-actions">
      <button
        type="button"
        class="flow-run-dialog-button"
        @click="rerunConfirmationVisible = false"
      >
        Cancel
      </button>
      <button
        type="button"
        class="flow-run-dialog-button is-primary"
        @click="confirmRerun"
      >
        {{ runFromStep ? 'Run from this step' : 'Run again' }}
      </button>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { getStepMetadata } from '@/api/type'
import { useCurrentStage } from '@/composables/useCurrentStage'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useBackendFlowStages } from '@/composables/useBackendFlowStages'
import { useSubflow } from '@/composables/useSubflow'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { useOptimizationEpisodeStore } from '@/stores/optimizationEpisodeStore'
import { flowNodeStatus, type FlowNodeStatus } from './flowStatus'

const props = defineProps<{
  step?: string
  status?: FlowNodeStatus
  showStepActions?: boolean
}>()

const rerunConfirmationVisible = ref(false)
const runFromStep = ref(false)
const preparingRerun = ref(false)
const { currentStage } = useCurrentStage()
const { isRunning, runFlow, runAllFlow } = useFlowRunner()
const {
  dynamicFlowStages,
  refreshFlowStages,
  setFirstRunStepOngoing,
  setRunStepOngoingByPath,
} = useBackendFlowStages()
const { overallStatus } = useSubflow()
const { currentProject, ensureApiReady, showToast, workspaceSession } = useWorkspace()
const optimizationEpisodes = useOptimizationEpisodeStore()
const chipViewerSaving = ref(false)
let chipViewerSavingTimer: ReturnType<typeof setInterval> | undefined

const flowRunControlBusy = computed(
  () =>
    preparingRerun.value ||
    isRunning.value ||
    dynamicFlowStages.value.some((stage) => flowNodeStatus(stage.state) === 'running') ||
    chipViewerSaving.value,
)
const parentRunGuarded = computed(() =>
  Boolean(
    optimizationEpisodes.episodeForParent(
      workspaceSession.value.workspaceId,
      currentProject.value?.path,
    ),
  ),
)
const flowRunControlDisabled = computed(
  () => flowRunControlBusy.value || parentRunGuarded.value,
)
const targetStep = computed(() => props.step ?? currentStage.value)
const isHomeStage = computed(() => !props.step && currentStage.value === 'home')
const runTargetLabel = computed(
  () =>
    (props.step && (getStepMetadata(props.step)?.label ?? props.step)) ||
    (isHomeStage.value ? 'the full flow' : 'this step'),
)
const runButtonLabel = computed(() =>
  parentRunGuarded.value
    ? 'Optimization is running in the background.'
    : chipViewerSaving.value
      ? 'Chip Viewer is saving layout edits'
      : isHomeStage.value
        ? 'Run full flow'
        : 'Run current step',
)
const hasFinishedFlow = computed(
  () =>
    dynamicFlowStages.value.length > 0 &&
    dynamicFlowStages.value.every((stage) => {
      const status = flowNodeStatus(stage.state)
      return (
        status === 'succeeded' ||
        status === 'warning' ||
        status === 'failed' ||
        status === 'skipped'
      )
    }),
)
const hasFinishedStep = computed(() =>
  props.status
    ? ['succeeded', 'warning', 'failed', 'skipped'].includes(props.status)
    : overallStatus.value === 'completed' || overallStatus.value === 'failed',
)
const needsRerunConfirmation = computed(() =>
  isHomeStage.value ? hasFinishedFlow.value : hasFinishedStep.value,
)

async function refreshChipViewerSaving(): Promise<void> {
  const projectPath = currentProject.value?.path
  if (!projectPath) {
    chipViewerSaving.value = false
    return
  }
  try {
    const status = await getDesktopApi().chipViewer.isOpen({
      projectPath,
      step: targetStep.value || 'Home',
    })
    chipViewerSaving.value = status.saving === true
  } catch {
    chipViewerSaving.value = false
  }
}

onMounted(() => {
  void refreshChipViewerSaving()
  chipViewerSavingTimer = setInterval(() => void refreshChipViewerSaving(), 500)
})

onBeforeUnmount(() => {
  if (chipViewerSavingTimer) clearInterval(chipViewerSavingTimer)
})

async function handleRunRequest(): Promise<void> {
  if (flowRunControlDisabled.value) return
  runFromStep.value = false
  if (needsRerunConfirmation.value) {
    rerunConfirmationVisible.value = true
    return
  }
  await executeRun(false)
}

function requestFromStep(): void {
  if (flowRunControlDisabled.value) return
  runFromStep.value = true
  rerunConfirmationVisible.value = true
}

async function confirmRerun(): Promise<void> {
  rerunConfirmationVisible.value = false
  if (runFromStep.value && props.step) {
    if (flowRunControlDisabled.value) return
    setRunStepOngoingByPath(props.step)
    await runAllFlow({ fromStep: props.step })
    return
  }
  await executeRun(true)
}

async function executeRun(rerun: boolean): Promise<void> {
  if (flowRunControlDisabled.value) return

  if (!(await ensureApiReady())) {
    await refreshFlowStages()
    return
  }

  if (rerun) {
    preparingRerun.value = true
    try {
      if (!isHomeStage.value && !(await canRerunCurrentStep())) {
        return
      }
    } catch (error) {
      showToast({
        severity: 'error',
        summary: 'Unable to Prepare Rerun',
        detail: error instanceof Error ? error.message : String(error),
        life: 15000,
      })
      return
    } finally {
      preparingRerun.value = false
    }
  }

  if (isHomeStage.value) {
    setFirstRunStepOngoing({ resetAll: rerun })
    await runAllFlow({ rerun })
    return
  }

  setRunStepOngoingByPath(targetStep.value)
  await runFlow({
    rerun,
    resetDependents: rerun,
    ...(props.step ? { step: props.step } : {}),
  })
}

async function canRerunCurrentStep(): Promise<boolean> {
  const projectPath = currentProject.value?.path
  if (!projectPath) return true

  const viewer = await getDesktopApi().chipViewer.isOpen({
    projectPath,
    step: targetStep.value,
  })
  if (!viewer.open) return true

  showToast({
    severity: 'warn',
    summary: 'Close Chip Viewer First',
    detail: 'Close the rendered layout for this step before rerunning it.',
    life: 15000,
  })
  return false
}
</script>

<style scoped>
.flow-run-control {
  display: flex;
}
.flow-step-actions {
  flex-wrap: wrap;
  gap: 8px;
}
.flow-step-actions .is-primary i {
  margin-inline-end: 4px;
}
.flow-step-actions button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.flow-run-icon-button {
  align-items: center;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  height: 25px;
  justify-content: center;
  padding: 0;
  width: 25px;
}

.flow-run-icon-button:hover:not(:disabled) {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.flow-run-start-button {
  background: var(--accent-color);
  border-color: var(--accent-color);
  color: #fff;
}

.flow-run-start-button:hover:not(:disabled) {
  color: #fff;
  opacity: 0.85;
}

.flow-run-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.flow-run-dialog-copy {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
  margin: 0;
}

.flow-run-dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 22px;
}

.flow-run-dialog-button {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  min-width: 76px;
  padding: 7px 10px;
}

.flow-run-dialog-button:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.flow-run-dialog-button.is-primary {
  background: var(--accent-color);
  border-color: var(--accent-color);
  color: #fff;
}
</style>
