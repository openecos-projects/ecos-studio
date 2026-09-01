import { describe, expect, it } from 'vitest'
import appSource from './App.vue?raw'

describe('App workspace reconfiguration wizard wiring', () => {
  it('does not let a failed zoom setting restore block app startup', () => {
    const restoreStart = appSource.indexOf(
      'if (desktopApi.value) {',
      appSource.indexOf('onMounted(async () =>'),
    )
    const restoreEnd = appSource.indexOf('themeStore.initTheme()', restoreStart)
    const restoreSource = appSource.slice(restoreStart, restoreEnd)

    expect(restoreSource).toContain('try {')
    expect(restoreSource).toContain('catch (error)')
    expect(restoreSource).toContain('Failed to restore UI zoom setting')
  })

  it('does not let zoom persistence failure reject after applying the factor', () => {
    const zoomStart = appSource.indexOf('async function setZoomFactor')
    const zoomEnd = appSource.indexOf('async function adjustZoom', zoomStart)
    const zoomSource = appSource.slice(zoomStart, zoomEnd)

    expect(zoomSource).toContain('await api.window.setZoomFactor(factor)')
    expect(zoomSource).toContain('await api.settings.set(zoomSettingKey, factor)')
    expect(zoomSource).toContain('Failed to persist UI zoom setting')
  })

  it('consumes second-instance openWorkspace query through the shared launch helper', () => {
    expect(appSource).toContain('consumeOpenWorkspaceLaunchQuery')
    expect(appSource).toContain('route.query.openWorkspace')
    expect(appSource).toContain("await router.replace('/workspace')")
    expect(appSource).toContain('delete nextQuery.openWorkspace')
  })

  it('restricts signoff export actions to the workspace route', () => {
    expect(appSource).not.toContain('signoff-package-export-enabled')
    expect(appSource).toContain('exportSignoffPackage,')
    expect(appSource).toContain('appMenuActionIds.exportSignoffPackage')
    expect(appSource).toContain(
      'if (isWorkspaceRoute.value) return exportSignoffPackage()',
    )
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
    expect(appSource).toContain('resolveProjectRouteContextForWorkspace')

    const openStart = appSource.indexOf('async function openWorkspaceReconfigureWizard')
    const openEnd = appSource.indexOf(
      'async function buildReconfigureWizardInitialConfig',
      openStart,
    )
    const openSource = appSource.slice(openStart, openEnd)
    expect(openSource).toContain('if (projectContext)')
    expect(openSource).toContain(
      'await api.workspace.registerProjectReadRoot(projectContext.projectRoot)',
    )
    expect(openSource).not.toContain('parentLocalPath')
  })

  it('keeps standalone workspace updates outside project management', () => {
    expect(appSource).toContain('standaloneWorkspace: !resolvedProjectContext')
    expect(appSource).toContain('project_context: resolvedProjectContext')
    expect(appSource).toContain(': undefined,')
    expect(appSource).not.toContain(
      'queryString(route.query.projectRoot) || parentLocalPath(workspacePath)',
    )
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

  it('keeps workspace replacement limited to explicit reconfiguration', () => {
    expect(appSource).not.toContain('registerHomeWorkspaceRerun')
    expect(appSource).not.toContain('rebuildCurrentWorkspaceForHomeRerun')
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

  it('opens Edit/Config after a successful new workspace create', () => {
    expect(appSource).toContain('requestOpenStepConfigAfterCreate')
    expect(appSource).toContain('usePendingOpenStepConfigAfterCreate')
    expect(appSource).toContain('showStepConfigDialog.value = true')

    const createStart = appSource.indexOf('const handleWizardCreate')
    const createEnd = appSource.indexOf(
      'function cancelWorkspaceUpdateBackup',
      createStart,
    )
    const createSource = appSource.slice(createStart, createEnd)
    expect(createSource).toContain('if (!success) return')
    expect(createSource).toContain('requestOpenStepConfigAfterCreate()')
    expect(createSource.indexOf('requestOpenStepConfigAfterCreate()')).toBeGreaterThan(
      createSource.indexOf('await syncProjectManagedWorkspace(config)'),
    )
    expect(createSource.indexOf("router.push('/workspace')")).toBeGreaterThan(
      createSource.indexOf('requestOpenStepConfigAfterCreate()'),
    )

    const updateStart = appSource.indexOf('async function runWorkspaceUpdate')
    const updateEnd = appSource.indexOf(
      'async function syncProjectManagedWorkspace',
      updateStart,
    )
    const updateSource = appSource.slice(updateStart, updateEnd)
    expect(updateSource).not.toContain('requestOpenStepConfigAfterCreate')
  })
})
