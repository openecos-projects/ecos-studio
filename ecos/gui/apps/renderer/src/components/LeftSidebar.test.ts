import { describe, expect, it } from 'vitest'
import source from './LeftSidebar.vue?raw'

describe('LeftSidebar workspace navigation', () => {
  it('preserves workspace route query when switching flow steps', () => {
    expect(source).toContain('useRoute')
    expect(source).toContain('workspaceStageLink(stage.path)')
    expect(source).toContain('function workspaceStageLink')
    expect(source).toContain('query: route.query')
    expect(source).not.toContain(`:to="'/workspace/' + stage.path"`)
  })

  it('does not render the legacy flow overview or reserve its side panel', () => {
    expect(source).not.toContain('Flow Overview')
    expect(source).not.toContain('RTL to GDS Pipeline')
    expect(source).not.toContain('w-[240px]')
  })

  it('keeps sidebar items within the fixed width so labels do not force horizontal scroll', () => {
    expect(source).toContain('overflow-y-auto')
    expect(source).not.toContain('overflow-x-hidden')
    expect(source).toContain('w-full min-w-0')
    expect(source).toContain('w-full max-w-full')
    expect(source).toContain('break-words')
    expect(source).not.toContain('scale-90')
  })

  it('shows a status badge for skipped flow steps', () => {
    expect(source).toContain(`stage.state === 'Skipped'`)
    expect(source).toContain('aria-label="Skipped"')
  })
})
