import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useFlowRunMode } from './useFlowRunMode'

describe('useFlowRunMode', () => {
  it('keeps full-flow and single-step run modes independent', () => {
    const currentStage = ref('home')
    const { activeRunMode, isRerun, runModes, selectRunMode } = useFlowRunMode(currentStage)

    expect(activeRunMode.value).toBe('run')
    expect(runModes.value.run.label).toBe('Run RTL2GDS')
    expect(runModes.value.rerun.label).toBe('ReRun RTL2GDS')

    selectRunMode('rerun')
    expect(activeRunMode.value).toBe('rerun')
    expect(isRerun.value).toBe(true)

    currentStage.value = 'Floorplan'
    expect(activeRunMode.value).toBe('run')
    expect(runModes.value.run.label).toBe('Run Step')
    expect(runModes.value.rerun.label).toBe('ReRun Step')
    expect(isRerun.value).toBe(false)

    selectRunMode('rerun')
    currentStage.value = 'home'
    expect(activeRunMode.value).toBe('rerun')
  })
})
