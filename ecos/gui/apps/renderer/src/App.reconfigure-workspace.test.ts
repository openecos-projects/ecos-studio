import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'

describe('App workspace reconfiguration wizard wiring', () => {
  it('opens the shared workspace wizard with current workspace data from the File menu', () => {
    expect(appSource).toContain(':initial-config="workspaceWizardInitialConfig"')
    expect(appSource).toContain(':title="workspaceWizardTitle"')
    expect(appSource).toContain("return reconfigureWorkspacePath.value ? 'Update Workspace' : 'New Workspace'")
    expect(appSource).toContain('reconfigureWorkspace: openWorkspaceReconfigureWizard')
    expect(appSource).toContain('buildReconfigureWizardInitialConfig')
    expect(appSource).toContain('replaceExistingWorkspace: true')
    expect(appSource).toContain('keepReplacementBackup')
    expect(appSource).toContain('lockWorkspaceDirectory: true')
    expect(appSource).toContain('readOptionalProjectTextFile')
  })

  it('asks whether to keep the old workspace backup before running update workspace', () => {
    expect(appSource).toContain('showWorkspaceUpdateBackupDialog')
    expect(appSource).toContain('pendingWorkspaceUpdateConfig')
    expect(appSource).toContain('confirmWorkspaceUpdateBackup')
    expect(appSource).toContain('runWorkspaceUpdate(true)')
    expect(appSource).toContain('runWorkspaceUpdate(false)')
    expect(appSource).toContain('Backup Original')
    expect(appSource).toContain('Do Not Backup')
  })

  it('prefers the current workspace origin files when building reconfigure defaults', () => {
    expect(appSource).toContain('scanWorkspaceOriginDesignInputs')
    const rtlStart = appSource.indexOf('const rtlList =')
    const rtlEnd = appSource.indexOf('const originDef =', rtlStart)
    const rtlSource = appSource.slice(rtlStart, rtlEnd)
    expect(rtlSource.indexOf('...originInputs.rtlFiles')).toBeLessThan(
      rtlSource.indexOf('...stringList(dbInput?.rtl_paths)'),
    )
    expect(rtlSource.indexOf('...originInputs.filelists')).toBeLessThan(
      rtlSource.indexOf('optionalString(dbInput?.filelist)'),
    )

    const defStart = appSource.indexOf('const originDef =')
    const defEnd = appSource.indexOf('const originVerilog =', defStart)
    const defSource = appSource.slice(defStart, defEnd)
    expect(defSource.indexOf('...originInputs.defFiles')).toBeLessThan(
      defSource.indexOf('optionalString(dbInput?.def_path)'),
    )

    const verilogStart = appSource.indexOf('const originVerilog =')
    const verilogEnd = appSource.indexOf('const sdc =', verilogStart)
    const verilogSource = appSource.slice(verilogStart, verilogEnd)
    expect(verilogSource.indexOf('...originInputs.verilogFiles')).toBeLessThan(
      verilogSource.indexOf('optionalString(dbInput?.verilog_path)'),
    )

    const sdcStart = appSource.indexOf('const sdc =')
    const sdcEnd = appSource.indexOf('return {', sdcStart)
    const sdcSource = appSource.slice(sdcStart, sdcEnd)
    expect(sdcSource.indexOf('...originInputs.sdcFiles')).toBeLessThan(
      sdcSource.indexOf('optionalString(dbInput?.sdc_path)'),
    )
    expect(appSource).toContain("'origin/filelist'")
    expect(appSource).toContain("fileName === 'filelist'")
    expect(appSource).toContain("hasAnySuffix(filePath, ['.def', '.def.gz'])")
    expect(appSource).toContain("hasAnySuffix(filePath, ['.v', '.v.gz', '.sv', '.sv.gz', '.vg', '.vg.gz'])")
    const existsStart = appSource.indexOf('async function workspaceTextFileExists')
    const existsEnd = appSource.indexOf('function optionalRecord', existsStart)
    const existsSource = appSource.slice(existsStart, existsEnd)
    expect(existsSource).toContain('catch')
    expect(existsSource).toContain('return false')
  })

  it('keeps cancel local to the wizard instead of navigating away from the workspace', () => {
    expect(appSource).toContain('@close="handleWizardClose"')
    expect(appSource).toContain('function handleWizardClose()')
    expect(appSource).toContain('resetWorkspaceWizard()')
  })
})
