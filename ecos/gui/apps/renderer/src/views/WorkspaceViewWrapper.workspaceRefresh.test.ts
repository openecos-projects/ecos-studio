import { describe, expect, it } from 'vitest'
import source from './WorkspaceViewWrapper.vue?raw'

describe('WorkspaceViewWrapper workspace refresh', () => {
  it('remounts workspace chrome when the active project changes', () => {
    expect(source).toContain('const workspaceViewKey = computed(')
    expect(source).toContain('<main :key="workspaceViewKey"')
  })
})
