import { describe, expect, it } from 'vitest'
import source from './WorkspaceView.vue?raw'

describe('WorkspaceView layout side panels', () => {
  it('does not mount embedded layout inspector panels', () => {
    expect(source).not.toContain('useLayoutState')
    expect(source).not.toContain('PropertiesPanel')
    expect(source).not.toContain('LayerPanel')
    expect(source).not.toContain('DrcViolationPanel')
    expect(source).not.toContain('showLayoutSidePanels')
    expect(source).not.toContain('hasLayoutInspectorContent')
  })

  it('keeps the drawing and thumbnail column in the shared workbench', () => {
    expect(source).toContain('<DrawingArea />')
    expect(source).toContain('<ThumbnailGallery />')
    expect(source).toContain('<WorkspaceWorkbench')
    expect(source).toContain('useSubflow')
    expect(source).not.toContain('<ChatInspectorPanel />')
  })

  it('does not render project labels above the workspace step canvas', () => {
    expect(source).not.toContain('projectContext')
    expect(source).not.toContain('project-context-strip')
    expect(source).not.toContain('project-context-copy')
    expect(source).not.toContain('{{ projectContext.projectName }}')
    expect(source).not.toContain("{{ projectContext.workspaceId || 'workspace' }}")
    expect(source).not.toContain('Back to Project')
    expect(source).not.toContain('Create Workspace From Current Step')
    expect(source).not.toContain('createWorkspaceFromCurrentStep')
    expect(source).not.toContain('project-context-actions')
  })

  it('renders the current flow step log with the same Home log panel', () => {
    expect(source).toContain("import FlowLogPanel from '@/components/workbench/FlowLogPanel.vue'")
    expect(source).toContain('useHomeData()')
    expect(source).toContain('const currentStepLogNode')
    expect(source).toContain('const stepKey = typeof route.params.step')
    expect(source).toContain('getStepMetadata(stepKey)')
    expect(source).toContain('<template #right-log>')
    expect(source).toContain(':selected-node="currentStepLogNode"')
    expect(source).toContain(':ensure-content="ensureFlowLogSegmentContentLoaded"')
  })

  it('keeps Step splitter styles out of the shared right-side workbench', () => {
    expect(source).toContain('.step-presentation-splitter :deep(.p-splitterpanel > *)')
    expect(source).toContain(
      '.step-presentation-splitter :deep(.p-splitter-vertical > .p-splitter-gutter)',
    )
    expect(source).not.toContain('\n:deep(.p-splitterpanel > *)')
  })
})
