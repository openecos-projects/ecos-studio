<template>
  <div class="flow-run-control">
    <button
      v-if="isRunning"
      type="button"
      class="flow-run-icon-button flow-run-cancel-button"
      :disabled="isCancelling && !cancellationUnconfirmed"
      :title="
        cancellationUnconfirmed
          ? 'Retry cancelling flow'
          : isCancelling
            ? 'Cancelling...'
            : 'Cancel flow'
      "
      @click="requestCancellation"
    >
      <i
        :class="isCancelling ? 'ri-loader-4-line animate-spin' : 'ri-stop-fill'"
        aria-hidden="true"
      />
    </button>
    <span v-if="isCancelling" class="flow-run-cancelling" role="status"
      >Cancelling...</span
    >
    <button
      v-if="!isRunning"
      type="button"
      class="flow-run-icon-button flow-run-start-button"
      :aria-busy="flowRunControlBusy"
      :disabled="flowRunControlBusy"
      :title="runButtonLabel"
      @click="handleRunRequest"
    >
      <i
        :class="flowRunControlBusy ? 'ri-loader-4-line animate-spin' : 'ri-play-fill'"
        aria-hidden="true"
      />
    </button>
  </div>

  <Dialog
    v-model:visible="rerunConfirmationVisible"
    modal
    :header="`Run ${runTargetLabel} again?`"
    :style="{ width: 'min(420px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <p class="flow-run-dialog-copy">
      {{ runTargetLabel }} has already finished. Running it again will replace its current
      execution results.
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
        Run again
      </button>
    </div>
  </Dialog>

  <Dialog
    v-model:visible="cancellationConfirmationVisible"
    modal
    header="Cancel flow?"
    :style="{ width: 'min(420px, calc(100vw - 32px))' }"
    :draggable="false"
  >
    <p class="flow-run-dialog-copy">
      This stops the ECC sidecar. Unfinished steps will be marked Incomplete.
    </p>
    <div class="flow-run-dialog-actions">
      <button
        type="button"
        class="flow-run-dialog-button"
        @click="cancellationConfirmationVisible = false"
      >
        Keep running
      </button>
      <button
        type="button"
        class="flow-run-dialog-button is-danger"
        @click="confirmCancellation"
      >
        Cancel flow
      </button>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { StateEnum } from '@/api/type'
import { useCurrentStage } from '@/composables/useCurrentStage'
import { useFlowRunArtifacts } from '@/composables/useFlowRunArtifacts'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useFlowStages } from '@/composables/useFlowStages'
import { prepareFlowLogSegmentForRerun } from '@/composables/useHomeData'
import { rerunHomeWorkspace } from '@/composables/homeFlowRerun'
import { useSubflow } from '@/composables/useSubflow'
import { useWorkspace } from '@/composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { flowNodeStatus } from './flowStatus'

const rerunConfirmationVisible = ref(false)
const cancellationConfirmationVisible = ref(false)
const cancellationUnconfirmed = ref(false)
let cancellationUnconfirmedTimer: ReturnType<typeof setTimeout> | null = null
const preparingRerun = ref(false)
const { currentStage } = useCurrentStage()
const {
  cancelFlow,
  isCancelling,
  isRunning,
  runFlow,
  runAllFlow,
  state: flowRunState,
} = useFlowRunner()
const { startFlowRunArtifactCapture } = useFlowRunArtifacts()
const {
  dynamicFlowStages,
  hasOngoingRunStage,
  refreshFlowStages,
  setFirstRunStepOngoing,
  setRunStepOngoingByPath,
} = useFlowStages()
const { overallStatus, refreshCurrentSubflow } = useSubflow()
const { currentProject, ensureApiReady, showToast } = useWorkspace()

const flowRunControlBusy = computed(
  () => preparingRerun.value || isRunning.value || hasOngoingRunStage.value,
)
const isHomeStage = computed(() => currentStage.value === 'home')
const runTargetLabel = computed(() => (isHomeStage.value ? 'the full flow' : 'this step'))
const runButtonLabel = computed(() =>
  isHomeStage.value ? 'Run full flow' : 'Run current step',
)
const hasFinishedFlow = computed(
  () =>
    dynamicFlowStages.value.length > 0 &&
    dynamicFlowStages.value.every((stage) => {
      const status = flowNodeStatus(stage.state)
      return status === 'succeeded' || status === 'failed' || status === 'skipped'
    }),
)
const hasFinishedStep = computed(
  () => overallStatus.value === 'completed' || overallStatus.value === 'failed',
)
const needsRerunConfirmation = computed(() =>
  isHomeStage.value ? hasFinishedFlow.value : hasFinishedStep.value,
)

watch(isRunning, (running) => {
  if (!running) {
    cancellationUnconfirmed.value = false
    clearCancellationUnconfirmedTimer()
  }
})

function clearCancellationUnconfirmedTimer(): void {
  if (!cancellationUnconfirmedTimer) return
  clearTimeout(cancellationUnconfirmedTimer)
  cancellationUnconfirmedTimer = null
}

function requestCancellation(): void {
  if (isCancelling.value && !cancellationUnconfirmed.value) return
  cancellationConfirmationVisible.value = true
}

async function confirmCancellation(): Promise<void> {
  cancellationConfirmationVisible.value = false
  cancellationUnconfirmed.value = false
  clearCancellationUnconfirmedTimer()
  try {
    const result = await cancelFlow()
    if (!result.accepted || !isRunning.value) return
    cancellationUnconfirmedTimer = setTimeout(() => {
      cancellationUnconfirmedTimer = null
      if (isRunning.value && isCancelling.value) {
        cancellationUnconfirmed.value = true
        showToast({
          severity: 'warn',
          summary: 'Cancellation Not Confirmed',
          detail: 'The ECC sidecar has not exited. Retry cancelling flow.',
          life: 8000,
        })
      }
    }, 6000)
  } catch (error) {
    showToast({
      severity: 'error',
      summary: 'Cancellation Failed',
      detail: error instanceof Error ? error.message : String(error),
      life: 6000,
    })
  }
}

async function handleRunRequest(): Promise<void> {
  if (flowRunControlBusy.value) return
  if (needsRerunConfirmation.value) {
    rerunConfirmationVisible.value = true
    return
  }
  await executeRun(false)
}

async function confirmRerun(): Promise<void> {
  rerunConfirmationVisible.value = false
  await executeRun(true)
}

async function executeRun(rerun: boolean): Promise<void> {
  if (flowRunControlBusy.value) return

  if (!(await ensureApiReady())) {
    await refreshFlowStages()
    return
  }

  if (rerun) {
    preparingRerun.value = true
    try {
      if (isHomeStage.value) {
        const rebuilt = await rerunHomeWorkspace()
        if (!rebuilt) {
          await refreshFlowStages()
          return
        }
        await refreshFlowStages()
      } else if (!(await canRerunCurrentStep())) {
        return
      } else {
        prepareFlowLogSegmentForRerun(currentStage.value)
      }
    } catch (error) {
      showToast({
        severity: 'error',
        summary: 'Unable to Prepare Rerun',
        detail: error instanceof Error ? error.message : String(error),
        life: 5000,
      })
      return
    } finally {
      preparingRerun.value = false
    }
  }

  const capture = await startFlowRunArtifactCapture({
    stepNames: isHomeStage.value
      ? dynamicFlowStages.value.map((stage) => stage.path)
      : [currentStage.value],
  })

  try {
    if (isHomeStage.value) {
      setFirstRunStepOngoing()
      if (rerun) {
        await runAllFlow({ rerun: false })
      } else {
        await runAllFlow({ rerun })
      }
      await refreshFlowStages()
      await capture.settle({
        forceStepNames:
          flowRunState.value === StateEnum.Success
            ? dynamicFlowStages.value.map((stage) => stage.path)
            : [],
      })
      return
    }

    setRunStepOngoingByPath(currentStage.value)
    const result = await runFlow({ rerun })
    await Promise.all([refreshCurrentSubflow(), refreshFlowStages()])
    await capture.settle({
      forceStepNames: result?.state === StateEnum.Success ? [currentStage.value] : [],
    })
  } finally {
    capture.stop()
  }
}

async function canRerunCurrentStep(): Promise<boolean> {
  const projectPath = currentProject.value?.path
  if (!projectPath) return true

  const viewer = await getDesktopApi().chipViewer.isOpen({
    projectPath,
    step: currentStage.value,
  })
  if (!viewer.open) return true

  showToast({
    severity: 'warn',
    summary: 'Close Chip Viewer First',
    detail: 'Close the rendered layout for this step before rerunning it.',
    life: 6000,
  })
  return false
}
</script>

<style scoped>
.flow-run-control {
  display: flex;
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

.flow-run-cancel-button {
  border-color: var(--danger-color, #d14343);
  color: var(--danger-color, #d14343);
}

.flow-run-cancelling {
  align-self: center;
  color: var(--text-secondary);
  font-size: 12px;
  margin-left: 6px;
  white-space: nowrap;
}

.flow-run-dialog-button.is-danger {
  background: var(--danger-color, #d14343);
  border-color: var(--danger-color, #d14343);
  color: #fff;
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
