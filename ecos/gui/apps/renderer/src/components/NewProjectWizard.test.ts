import { describe, expect, it } from 'vitest'
import source from './NewProjectWizard.vue?raw'

describe('NewProjectWizard RTL browsing', () => {
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
    expect(source).toContain(
      'Folders cannot be uploaded from Select RTL files. Use Select design folder to scan a folder.',
    )
  })

  it('accepts initial config so project management can prefill the workspace path', () => {
    expect(source).toContain('initialConfig')
    expect(source).toContain('defineProps')
    expect(source).toContain('props.initialConfig')
  })

  it('can derive a project-managed workspace path from project root plus workspace name', () => {
    expect(source).toContain('managedWorkspaceRoot')
    expect(source).toContain('deriveDirectoryFromDesign')
    expect(source).toContain('syncManagedWorkspaceDirectory')
    expect(source).toContain('joinPath(managedWorkspaceRoot.value, workspaceName)')
  })
})
