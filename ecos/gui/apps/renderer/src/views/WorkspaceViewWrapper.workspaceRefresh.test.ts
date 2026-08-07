import { describe, expect, it } from 'vitest'
import source from './WorkspaceViewWrapper.vue?raw'

describe('WorkspaceViewWrapper workspace refresh', () => {
  it('remounts workspace chrome when the active project changes', () => {
    expect(source).toContain('const workspaceViewKey = computed(')
    expect(source).toContain('<main :key="workspaceViewKey"')
  })

  it('keeps the Agent in the workbench instead of rendering a duplicate right rail', () => {
    expect(source).not.toContain('ChatInspectorPanel')
    expect(source).not.toContain('workspace-chat-rail')
  })
})
