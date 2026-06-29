import { describe, expect, it } from 'vitest'
import source from './DesignFilesManageDialog.vue?raw'

describe('DesignFilesManageDialog RTL browsing', () => {
  it('keeps folder browsing available while the file action uses the RTL single-file picker', () => {
    expect(source).toContain('Select design folder...')
    expect(source).toContain('browseRtlFolder')
    expect(source).toContain('dialog.pickDirectory')

    expect(source).toContain('dialog.pickRtlSources')
    expect(source).toContain('multiple: false')
    expect(source).not.toContain('dialog.pickFiles({')
  })

  it('shows a clear prompt when a folder is submitted through the file upload action', () => {
    expect(source).toContain('showDirectoryUploadFailurePrompt')
    expect(source).toContain('Folder Upload Failed')
    expect(source).toContain('Folders cannot be uploaded from Select RTL files. Use Select design folder to scan a folder.')
  })
})
