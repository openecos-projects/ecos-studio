import { describe, expect, it } from 'vitest'
import source from './PdkResourcePickerDialog.vue?raw'

describe('PdkResourcePickerDialog', () => {
  it('uses a three-column transfer dialog for PDK resources', () => {
    expect(source).toContain('PDK Resource Selection')
    expect(source).toContain('v-model="searchQuery"')
    expect(source).toContain('PDK Folder Browser')
    expect(source).toContain('Selected Paths')
    expect(source).toContain('directoryTree')
    expect(source).toContain('buildRtlFileTree')
    expect(source).toContain('Add to selection')
    expect(source).toContain('Remove from selection')
    expect(source).toContain('Save')
    expect(source).toContain('draftSelectedFiles.length')
    expect(source).toContain('selectedSelection.length')
    expect(source).toContain('bg-(--accent-color)')
    expect(source).toContain('text-white')
    expect(source).toContain('ri-arrow-right-line')
    expect(source).toContain('ri-arrow-left-line')
    expect(source).toContain('@click.self="closeDialog"')
    expect(source).not.toContain('Select visible')
    expect(source).not.toContain('Remove all')
    expect(source).not.toContain('Done')
  })
})
