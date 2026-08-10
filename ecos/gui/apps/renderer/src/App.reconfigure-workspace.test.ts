import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'

describe('App workspace reconfiguration wizard wiring', () => {
  it('consumes second-instance openWorkspace query through the shared launch helper', () => {
    expect(appSource).toContain('consumeOpenWorkspaceLaunchQuery')
    expect(appSource).toContain('route.query.openWorkspace')
    expect(appSource).toContain("await router.replace('/workspace')")
    expect(appSource).toContain('delete nextQuery.openWorkspace')
  })

  it('passes signoff eligibility to the visible top bar menu', () => {
    expect(appSource).toContain(
      ':signoff-package-export-enabled="signoffPackageExportEnabled"',
    )
    expect(appSource).toContain('exportSignoffPackage,')
    expect(appSource).toContain('signoffPackageExportEnabled,')
  })

  it('opens the shared workspace wizard with current workspace data from the File menu', () => {
    expect(appSource).toContain(':initial-config="workspaceWizardInitialConfig"')
    expect(appSource).toContain(':title="workspaceWizardTitle"')
    expect(appSource).toContain(
      "return reconfigureWorkspacePath.value ? 'Update Workspace' : 'New Workspace'",
    )
    expect(appSource).toContain('reconfigureWorkspace: openWorkspaceReconfigureWizard')
    expect(appSource).toContain('buildReconfigureWizardInitialConfig')
    expect(appSource).toContain('replaceExistingWorkspace: true')
    expect(appSource).toContain('keepReplacementBackup')
    expect(appSource).toContain('lockWorkspaceDirectory: true')
    expect(appSource).toContain('readOptionalProjectTextFile')
    expect(appSource).toContain('registerProjectReadRoot')
    expect(appSource).toContain('parentLocalPath(normalizedWorkspacePath)')
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

  it('rebuilds the current workspace without a backup before a Home rerun', () => {
    expect(appSource).toContain('registerHomeWorkspaceRerun')
    expect(appSource).toContain('rebuildCurrentWorkspaceForHomeRerun')
    expect(appSource).toContain('replaceExistingWorkspace: true')
    expect(appSource).toContain('keepReplacementBackup: false')
    expect(appSource).toContain(
      'buildReconfigureWizardInitialConfig(targetWorkspacePath)',
    )
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
    expect(appSource).toContain(
      "hasAnySuffix(filePath, ['.v', '.v.gz', '.sv', '.sv.gz', '.vg', '.vg.gz'])",
    )
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

  it('keeps native close cancellation retryable when sidecar exit is unconfirmed', () => {
    expect(appSource).toContain('WINDOW_CLOSE_CANCELLATION_TIMEOUT_MS = 6000')
    expect(appSource).toContain('windowCloseCancellationUnconfirmed')
    expect(appSource).toContain('Retry cancelling flow')
    expect(appSource).toContain('Cancellation Not Confirmed')
    expect(appSource).toContain('if (!isFlowRunning.value) {')
  })

  it('records project-managed workspaces into project.json after wizard create and reconfigure', () => {
    expect(appSource).toContain('registerProjectManagedWorkspace')
    expect(appSource).toContain('syncProjectManagedWorkspace')
    expect(appSource).toContain('projectContextFromWorkspaceConfig')
    expect(appSource).toContain('await syncProjectManagedWorkspace(config)')

    const updateStart = appSource.indexOf('async function runWorkspaceUpdate')
    const updateSync = appSource.indexOf(
      'await syncProjectManagedWorkspace(config, normalizeLocalPath(targetReconfigurePath))',
      updateStart,
    )
    expect(updateSync).toBeGreaterThan(updateStart)
  })
})
