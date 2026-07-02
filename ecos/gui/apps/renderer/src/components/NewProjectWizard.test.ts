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

describe('NewProjectWizard workspace wizard redesign', () => {
  it('uses the six-step New Workspace flow from the design document', () => {
    expect(source).toContain('New Workspace')
    expect(source).not.toContain('New Project')

    for (const title of [
      'Project Setup',
      'Basic Info',
      'Flow Setup',
      'Design Files',
      'PDK Config',
      'Spec Setting',
    ]) {
      expect(source).toContain(`title: '${title}'`)
    }

    expect(source).toContain('Create Workspace')
    expect(source).not.toContain('Review & Create')
  })

  it('derives workspace location from project root and workspace name', () => {
    expect(source).toContain('workspaceLocation')
    expect(source).toContain('projectContext.project_root')
    expect(source).toContain('workspaceName')
    expect(source).not.toContain('workspaces/ws_0005')
    expect(source).not.toContain('workspaces/<workspace_id>')
  })

  it('defines harden flow range selection in build_harden_flow order', () => {
    for (const step of [
      'Synthesis',
      'Floorplan',
      'fixFanout',
      'place',
      'CTS',
      'legalization',
      'route',
      'drc',
      'filler',
      'RCX',
      'sta',
      'Harden',
    ]) {
      expect(source).toContain(`name: '${step}'`)
    }

    expect(source).toContain('selectedFlowSteps')
    expect(source).toContain('setFlowBoundary')
  })

  it('keeps SDC in Design Files and removes it from PDK Config', () => {
    expect(source).toContain('designInputTypes')
    expect(source).toContain('Import SDC')
    expect(source).toContain('SDC is optional')
    expect(source).toContain('pdkWizardSteps')
    expect(source).not.toContain("title: 'SDC'")
    expect(source).not.toContain('SPEF')
    expect(source).not.toContain('spef')
  })

  it('supports ECC default PDK config as a Step 5 mode', () => {
    expect(source).toContain('Default Config')
    expect(source).toContain('Manual Config')
    expect(source).toContain('Use ECC default PDK config')
    expect(source).toContain("const pdkConfigMode = ref<'default' | 'manual'>('default')")
    expect(source).toContain("pdk_config_mode: 'default'")
    expect(source).toContain("mode: pdkConfigMode.value")
    expect(source).toContain("pdkConfigMode.value === 'default'")
  })

  it('allows compressed and uncompressed design file imports', () => {
    expect(source).toContain('Supports .v, .sv, .vhd, .vhdl, and .gz-compressed RTL files')
    expect(source).toContain('Please select RTL design files only (.v, .sv, .vhd, .vhdl, or .gz-compressed HDL).')
    expect(source).toContain("extensions: ['f', 'fl', 'flist', 'filelist', 'lst', 'txt', 'gz']")
    expect(source).toContain("extensions: ['sdc', 'gz']")
    expect(source).toContain("extensions: ['def', 'gz']")
    expect(source).toContain("extensions: ['v', 'sv', 'vg', 'gz']")
  })

  it('keeps Spec Setting limited to parameters.json fields', () => {
    for (const label of [
      'Design Name',
      'Top Module Name',
      'Clock Signal Name',
      'Die Area',
      'Frequency max [MHz]',
      'Max Fanout',
    ]) {
      expect(source).toContain(label)
    }

    expect(source).toContain('dieAreaMode')
    expect(source).not.toContain('Target Density')
    expect(source).not.toContain('Floorplan mode')
  })
})
