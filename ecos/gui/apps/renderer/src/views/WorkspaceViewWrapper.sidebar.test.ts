import { describe, expect, it } from 'vitest'
import source from './WorkspaceViewWrapper.vue?raw'

describe('WorkspaceViewWrapper sidebar selection', () => {
  it('keeps frontend and backend workspace navigation isolated', () => {
    expect(source).toContain(
      `<FrontendLeftSidebar v-if="currentProject?.designTool === 'frontend'" />`,
    )
    expect(source).toContain('<LeftSidebar v-else />')
    expect(source).toContain('const { closeProject, currentProject } = useWorkspace()')
  })
})
