import { describe, expect, it } from 'vitest'
import source from './WorkspaceStepConfigDialog.vue?raw'

describe('WorkspaceStepConfigDialog', () => {
  it('lists only steps from the active workspace flow and edits the selected one', () => {
    expect(source).toContain('useFlowStages()')
    expect(source).toContain('dynamicFlowStages.value.flatMap')
    expect(source).toContain('<StepConfigPanel')
    expect(source).toContain(':step="selectedStep"')
    expect(source).toContain(':tool="selectedTool"')
    expect(source).not.toContain('router.push')
    expect(source).toContain('selectStep(item.step)')
    expect(source).toContain('formatStepToolName(stage.tool)')
    expect(source).toContain('item.tool')
    expect(source).toContain('confirmDiscardChanges()')
    expect(source).toContain("confirm('Discard unsaved configuration changes?')")
  })
})
