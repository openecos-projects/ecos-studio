<template>
  <div class="flow-run-control">
    <button
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
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { StateEnum } from '@/api/type'
import { useCurrentStage } from '@/composables/useCurrentStage'
import { useFlowRunArtifacts } from '@/composables/useFlowRunArtifacts'
import { useFlowRunner } from '@/composables/useFlowRunner'
import { useFlowStages } from '@/composables/useFlowStages'
import { useSubflow } from '@/composables/useSubflow'
import { useWorkspace } from '@/composables/useWorkspace'
import { flowNodeStatus } from './flowStatus'

const rerunConfirmationVisible = ref(false)
const { currentStage } = useCurrentStage()
const { isRunning, runFlow, runAllFlow, state: flowRunState } = useFlowRunner()
const { startFlowRunArtifactCapture } = useFlowRunArtifacts()
const {
  dynamicFlowStages,
  hasOngoingRunStage,
  refreshFlowStages,
  setFirstRunStepOngoing,
  setRunStepOngoingByPath,
} = useFlowStages()
const { overallStatus, refreshCurrentSubflow } = useSubflow()
const { ensureApiReady } = useWorkspace()

const flowRunControlBusy = computed(() => isRunning.value || hasOngoingRunStage.value)
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

  const capture = await startFlowRunArtifactCapture({
    stepNames: isHomeStage.value
      ? dynamicFlowStages.value.map((stage) => stage.path)
      : [currentStage.value],
  })

  try {
    if (isHomeStage.value) {
      setFirstRunStepOngoing()
      await runAllFlow({ rerun })
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
