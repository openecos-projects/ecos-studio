import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useFlowRunMode } from './useFlowRunMode'

describe('useFlowRunMode', () => {
  it('keeps full-flow and single-step run modes independent', () => {
    const currentStage = ref('home')
    const { activeRunMode, isRerun, runModes, selectRunMode } =
      useFlowRunMode(currentStage)

    expect(activeRunMode.value).toBe('run')
    expect(runModes.value.run.label).toBe('Run RTL2GDS')

    selectRunMode('rerun')
    expect(isRerun.value).toBe(true)

    currentStage.value = 'Floorplan'
    expect(activeRunMode.value).toBe('run')
    expect(runModes.value.run.label).toBe('Run Step')

    selectRunMode('rerun')
    currentStage.value = 'home'
    expect(activeRunMode.value).toBe('rerun')
  })

  it('uses the frontend flow name only in the full-flow context', () => {
    const currentStage = ref('home')
    const fullFlowLabel = ref('Frontend Flow')
    const { runModes } = useFlowRunMode(currentStage, { fullFlowLabel })

    expect(runModes.value.run.label).toBe('Run Frontend Flow')
    expect(runModes.value.rerun.label).toBe('ReRun Frontend Flow')

    currentStage.value = 'prepare'
    expect(runModes.value.run.label).toBe('Run Step')
  })
})
