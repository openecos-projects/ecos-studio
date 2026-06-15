import { describe, expect, it } from 'vitest'
import source from './TechLibraryView.vue?raw'

describe('TechLibraryView workbench UI', () => {
  it('exposes the Tech Workbench structure for scanning and inspection', () => {
    expect(source).toContain('class="tech-workbench"')
    expect(source).toContain('class="source-pill"')
    expect(source).toContain('class="count-badge"')
    expect(source).toContain('class="resource-summary"')
    expect(source).toContain('class="resource-row"')
    expect(source).toContain('class="data-table-header"')
    expect(source).toContain('class="tech-inspector"')
    expect(source).toContain(`v-if="activeSection !== 'overview'"`)
    expect(source).toContain(`:class="{ overview: activeSection === 'overview' }"`)
    expect(source).toContain(`v-if="hasPreview"`)
    expect(source).toContain('class="preview-panel"')
    expect(source).toContain('@media (max-width: 1180px)')
  })

  it('keeps table selection and inspector empty copy section-aware', () => {
    expect(source).toContain(':aria-selected="selected === row"')
    expect(source).toContain('detailEmptyText')
    expect(source).not.toContain('Select a via or cell master to inspect geometry.')
  })
})
