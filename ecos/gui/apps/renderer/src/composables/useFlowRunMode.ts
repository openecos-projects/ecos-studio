import { computed, ref, type Ref } from 'vue'

export type FlowRunModeKey = 'run' | 'rerun'

export interface FlowRunModeOption {
  label: string
  icon: string
  shortcut?: string
}

function isHomeStage(stage: string | undefined | null): boolean {
  return stage === 'home'
}

export function useFlowRunMode(currentStage: Ref<string | undefined | null>) {
  const fullFlowRunMode = ref<FlowRunModeKey>('run')
  const stepRunMode = ref<FlowRunModeKey>('run')

  const isFullFlowContext = computed(() => isHomeStage(currentStage.value))

  const activeRunMode = computed({
    get: () => isFullFlowContext.value ? fullFlowRunMode.value : stepRunMode.value,
    set: (mode: FlowRunModeKey) => {
      if (isFullFlowContext.value) {
        fullFlowRunMode.value = mode
      } else {
        stepRunMode.value = mode
      }
    },
  })

  const runModes = computed<Record<FlowRunModeKey, FlowRunModeOption>>(() => {
    const target = isFullFlowContext.value ? 'RTL2GDS' : 'Step'

    return {
      run: { label: `Run ${target}`, icon: 'ri-play-fill' },
      rerun: { label: `ReRun ${target}`, icon: 'ri-restart-line' },
    }
  })

  const isRerun = computed(() => activeRunMode.value === 'rerun')

  function selectRunMode(mode: string): void {
    if (mode === 'run' || mode === 'rerun') {
      activeRunMode.value = mode
    }
  }

  return {
    activeRunMode,
    isRerun,
    runModes,
    selectRunMode,
  }
}
