import { describe, expect, it } from 'vitest'
import source from './NewProjectWizard.vue?raw'

function expectSourceCall(name: string, firstArgument: string) {
  expect(source).toMatch(new RegExp(`${name}\\(\\s*${firstArgument}`))
}

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
    expect(source).not.toContain('suggestedWorkspaceName')
  })

  it('uses the project design name as the workspace spec default', () => {
    const defaultsStart = source.indexOf('function applyProjectManifestDefaults')
    const defaultsEnd = source.indexOf('function applyProjectFlowDefaults', defaultsStart)
    const defaultsSource = source.slice(defaultsStart, defaultsEnd)
    expect(defaultsSource).toContain('projectDesignName.value = manifest.design_name')
    expect(defaultsSource).toContain('designNameTouched.value = true')
  })

  it('can derive a project-managed workspace path from project root plus workspace name', () => {
    expect(source).toContain('managedWorkspaceRoot')
    expect(source).toContain('deriveDirectoryFromDesign')
    expect(source).toContain('syncManagedWorkspaceDirectory')
    expect(source).toContain('joinPath(managedWorkspaceRoot.value, workspaceName)')
  })

  it('offers project history entries when selecting a project', () => {
    expect(source).toContain('loadProjectHistory')
    expect(source).toContain('projectHistory')
    expect(source).toContain('Recent Projects')
    expect(source).toContain('selectProjectFromHistory')
    expect(source).toContain('v-for="project in projectHistory"')
  })

  it('uses the project workspace naming rule for the default workspace name', () => {
    expect(source).toContain('defaultWorkspaceName')
    expect(source).toContain('nextWorkspaceNameForProject')
    expect(source).toContain('readProjectManagementManifest')
    expect(source).not.toContain("readOptionalProjectTextFile('project.json'")
    expect(source).toContain('parseProjectManifest')
    expect(source).toContain("`ws_${String(next).padStart(4, '0')}`")
  })

  it('applies project.json defaults after selecting a project history entry', () => {
    expect(source).toContain('applyProjectDefaultsForProject')
    expect(source).toContain('readProjectManifestForProject')
    expect(source).toContain('applyProjectManifestDefaults')
    expect(source).toContain('manifest.base_design')
    expect(source).toContain('projectContext.value.project_id = manifest.project_id')
    expect(source).toContain('config.value.pdk = baseDesign.pdk')
    expect(source).toContain('config.value.pdk_root = baseDesign.pdk_root')
    expectSourceCall('setStringParameterDefault', "'top_module'")
    expectSourceCall('setStringParameterDefault', "'clock'")
    expectSourceCall('setStringParameterDefault', "'design'")

    const selectStart = source.indexOf('async function selectProjectFromHistory')
    const selectEnd = source.indexOf('async function selectProjectRoot', selectStart)
    const selectSource = source.slice(selectStart, selectEnd)
    expect(selectSource).toContain('await applyProjectDefaultsForProject(projectRoot)')
  })

  it('loads the selected project MPC snapshot and applies die-area bounds only in Width / Height mode', () => {
    expect(source).toContain('projectMpc')
    expect(source).toContain('projectManifestError')
    expect(source).toContain('isLoadingProjectManifest')
    expect(source).toContain('validateMpcDieArea')
    expect(source).toContain('config.value.mpc = projectMpc.value')
    expect(source).toContain("dieAreaMode.value === 'width_height'")
    expect(source).toContain('!mpcDieAreaValidation.value.error')
    expect(source).toContain(
      'MPC die-area bounds are checked after the flow runs for this mode.',
    )
  })

  it('can lock the workspace directory when reconfiguring an existing workspace', () => {
    expect(source).toContain('title?: string')
    expect(source).toContain('wizardTitle')
    expect(source).toContain('{{ wizardTitle }}')
    expect(source).toContain('lockWorkspaceDirectory')
    expect(source).toContain(':disabled="lockWorkspaceDirectory"')
    expect(source).toContain('normalizePath(props.initialConfig.directory)')
  })

  it('updates standalone workspaces without inventing a project context', () => {
    expect(source).toContain('standaloneWorkspace?: boolean')
    expect(source).toContain('v-if="standaloneWorkspace"')
    expect(source).toContain('Review the standalone workspace that will be updated.')
    expect(source).toContain('if (standaloneWorkspace.value) return')
    expect(source).toContain('delete config.value.project_context')

    const configStart = source.indexOf('function createInitialConfig')
    const configEnd = source.indexOf('function createInitialProjectContext', configStart)
    const configSource = source.slice(configStart, configEnd)
    expect(configSource).toContain('initialConfig?.standaloneWorkspace')
    expect(configSource).toContain('? undefined')
  })

  it('shows project branch source context for derived workspaces', () => {
    expect(source).toContain('sourceContext')
    expect(source).toContain('Created from')
    expect(source).toContain('sourceContext.projectName')
    expect(source).toContain('sourceContext.workspaceName')
    expect(source).toContain('sourceContext.step')
  })

  it('closes the modal when clicking the overlay or pressing Escape', () => {
    expect(source).toContain('@click.self="closeWizard"')
    expect(source).toContain('@click="closeWizard"')
    expect(source).toContain("document.addEventListener('keydown', handleWizardKeydown)")
    expect(source).toContain(
      "document.removeEventListener('keydown', handleWizardKeydown)",
    )
    expect(source).toContain("event.key !== 'Escape'")
    expect(source).toContain("emit('close')")
  })

  it('closes the PDK resource picker before closing the wizard on Escape', () => {
    const handlerStart = source.indexOf('function handleWizardKeydown')
    const handlerEnd = source.indexOf('function nextStep', handlerStart)
    const handlerSource = source.slice(handlerStart, handlerEnd)

    expect(handlerSource).toContain('if (pdkResourcePickerOpen.value)')
    expect(handlerSource).toContain('closePdkResourcePicker()')
    expect(handlerSource).toContain('return')
  })

  it('locks flow steps before the derived workspace start step', () => {
    expect(source).toContain('lockedFlowStepNames')
    expect(source).toContain('isFlowStepLocked')
    expect(source).toContain('Cannot select steps before the source output')
    expect(source).toContain('sourceContext.startStep')
    expect(source).toContain(':disabled="isFlowStepLocked(step.name)"')
    expect(source).toContain('v-for="step in hardenFlowSteps"')
  })

  it('reuses source workspace design, PDK, SDC, and spec defaults', () => {
    expect(source).toContain('source_config')
    expect(source).toContain('applySourceWorkspaceDefaults')
    expect(source).toContain('config.value.origin_def')
    expect(source).toContain('config.value.origin_verilog')
    expect(source).toContain('sdcPath.value')
    expect(source).toContain('pdkSelections.value')
    expect(source).toContain('Object.assign(config.value.parameters')
  })

  it('shows initial RTL files in the Design Files list when reconfiguring a workspace', () => {
    expect(source).toContain('initialRtlFiles')
    expect(source).toContain('props.initialConfig?.rtl_list')
    expect(source).toContain('props.initialConfig?.source_config?.rtl_list')
    expect(source).toContain(
      'const manuallyAddedFiles = ref<string[]>([...initialRtlFiles])',
    )
  })

  it('opens Filelist by default when synthesis reconfigure has a filelist but no RTL files', () => {
    expect(source).toContain('initialFilelistPath')
    expect(source).toContain('initialDesignInputType')
    expect(source).toContain(
      "return initialRtlFiles.length > 0 || !initialFilelistPath ? 'rtl' : 'filelist'",
    )
  })

  it('does not require DEF when the flow starts from Floorplan', () => {
    expect(source).toContain('startsFromFloorplan')
    expect(source).toContain("if (startStep === 'Floorplan') return 'verilog'")

    const designTypesStart = source.indexOf(
      'const designInputTypes = computed<DesignInputType[]>',
    )
    const designTypesEnd = source.indexOf('const activeDesignInput', designTypesStart)
    const designTypesSource = source.slice(designTypesStart, designTypesEnd)
    expect(designTypesSource).toContain('startsFromFloorplan.value')
    expect(designTypesSource).toContain("key: 'verilog'")
    expect(designTypesSource).toContain(
      'Import the synthesized Verilog netlist for floorplan.',
    )

    const floorplanBranchSource =
      designTypesSource.match(
        /if \(startsFromFloorplan\.value\) \{[\s\S]*?\n  \}/,
      )?.[0] ?? ''
    expect(floorplanBranchSource).not.toContain("key: 'def'")

    const readyStart = source.indexOf('function designFilesReady')
    const readyEnd = source.indexOf('function selectPdk', readyStart)
    const readySource = source.slice(readyStart, readyEnd)
    expect(readySource).toContain('if (startsFromFloorplan.value)')
    expect(readySource).toContain("return config.value.origin_verilog.trim() !== ''")

    const initialConfigStart = source.indexOf('function createInitialConfig')
    const initialConfigEnd = source.indexOf(
      'function createInitialProjectContext',
      initialConfigStart,
    )
    const initialConfigSource = source.slice(initialConfigStart, initialConfigEnd)
    expect(initialConfigSource).toContain(
      "startStep === 'Synthesis' || startStep === 'Floorplan'",
    )

    const sourceDefaultsStart = source.indexOf('function applySourceWorkspaceDefaults')
    const sourceDefaultsEnd = source.indexOf(
      'function closeBrowseMenu',
      sourceDefaultsStart,
    )
    const sourceDefaultsSource = source.slice(sourceDefaultsStart, sourceDefaultsEnd)
    expect(sourceDefaultsSource).toContain('!startsFromFloorplan.value')
  })
})

describe('NewProjectWizard workspace wizard redesign', () => {
  it('uses the six-step New Workspace flow from the design document', () => {
    expect(source).toContain('New Workspace')
    expect(source).not.toContain('New Project')

    for (const title of [
      'Basic Info',
      'Flow Setup',
      'Design Files',
      'PDK Config',
      'Spec Setting',
    ]) {
      expect(source).toContain(`title: '${title}'`)
    }

    expect(source).toContain("'Workspace Setup' : 'Project Setup'")

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
      'place',
      'CTS',
      'legalization',
      'Timing optimization',
      'route',
      'drc',
      'lvs',
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

  it('uses neutral connector lines between flow setup step cards', () => {
    expect(source).toContain('flow-step-connector')
    expect(source).toContain('flow-step-connector-line')
    expect(source).toContain('flow-step-connector-dot')
    expect(source).toContain('aria-hidden="true"')
    expect(source).not.toContain('ri-corner-right-down-line')
    expect(source).not.toContain('ri-corner-right-up-line')
  })

  it('keeps flow setup order numbers visible for selected steps', () => {
    const stepCardStart = source.indexOf('v-for="(step, index) in hardenFlowSteps"')
    const stepCardEnd = source.indexOf('flow-step-connector', stepCardStart)
    const stepCardSource = source.slice(stepCardStart, stepCardEnd)

    expect(stepCardSource).toContain('{{ index + 1 }}')
    expect(stepCardSource).not.toContain('ri-check-line')
    expect(stepCardSource).not.toContain('v-if="isFlowStepSelected(step.name)"')
    expect(stepCardSource).not.toContain('v-else>{{ index + 1 }}</span>')
  })

  it('allows fresh workspaces to start the flow from any step', () => {
    expect(source).toContain('canChooseFlowStartStep')
    expect(source).toContain('!sourceContext.value && !lockWorkspaceDirectory.value')
    expect(source).toContain('v-if="canChooseFlowStartStep"')
    expect(source).toContain('@change="selectFlowStartStep"')
    expect(source).toContain(':value="flowStartStep"')

    const boundaryStart = source.indexOf('function setFlowBoundary')
    const boundaryEnd = source.indexOf('async function ensurePdksLoaded', boundaryStart)
    const boundarySource = source.slice(boundaryStart, boundaryEnd)

    expect(boundarySource).toContain(
      'if (canChooseFlowStartStep.value && index < start) {',
    )
    expect(boundarySource).toContain('applyFlowStartStep(stepName)')
    expect(boundarySource).toContain(
      'const nextEndIndex = index === end && end > start ? end - 1 : index',
    )
    expect(boundarySource).toContain(
      'const boundedEndIndex = Math.max(start, nextEndIndex)',
    )
    expect(boundarySource).toContain(
      'flowEndStep.value = hardenFlowSteps[boundedEndIndex].name',
    )
  })

  it('clamps the end step when the start step moves past it', () => {
    const applyStart = source.indexOf('function applyFlowStartStep')
    const applyEnd = source.indexOf('async function ensurePdksLoaded', applyStart)
    const applySource = source.slice(applyStart, applyEnd)

    expect(applySource).toContain('flowStartStep.value = stepName')
    expect(applySource).toContain('if (flowEndIndex.value < index) {')
    expect(applySource).toContain('flowEndStep.value = stepName')
    expect(applySource).toContain(
      'activeDesignInputType.value = initialDesignInputType(stepName)',
    )
  })

  it('keeps the source output start step pinned for derived workspaces', () => {
    const selectStart = source.indexOf('function selectFlowStartStep')
    const selectEnd = source.indexOf('function applyFlowStartStep', selectStart)
    const selectSource = source.slice(selectStart, selectEnd)

    expect(selectSource).toContain(
      'if (!canChooseFlowStartStep.value || isFlowStepLocked(stepName)) {',
    )
    expect(selectSource).toContain('target.value = flowStartStep.value')
    expect(selectSource).toContain('return')
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
    expect(source).toContain("const pdkConfigMode = ref<'default' | 'manual'>(")
    expect(source).toContain('normalizePdkConfigMode')
    expect(source).toContain('props.initialConfig?.source_config?.pdk_config_mode')
    expect(source).toContain("pdk_config_mode: 'default'")
    expect(source).toContain('mode: pdkConfigMode.value')
    expect(source).toContain("pdkConfigMode.value === 'default'")
  })

  it('explains why an invalid PDK cannot use ECC defaults', () => {
    expect(source).toContain('defaultConfigUnavailableReason')
    expect(source).toContain('PDK validation failed')
    expect(source).toContain('PDK path is unavailable.')
    expect(source).toContain('ECC defaults are only available for a known PDK layout.')
    expect(source).toContain('pdkValidationMessage')
  })

  it('keeps PDK actions outside the selection button', () => {
    const cardMarker = source.indexOf('v-for="pdk in pdkOptions"')
    const cardStart = source.lastIndexOf('<div', cardMarker)
    const selectionStart = source.indexOf(
      ':aria-pressed="selectedPdkId === pdk.id"',
      cardStart,
    )
    const selectionEnd = source.indexOf('</button>', selectionStart)
    const actionStart = source.indexOf('handleValidatePdk(pdk.id)', selectionStart)
    const cardSource = source.slice(cardStart, actionStart)

    expect(cardSource).toContain('<div')
    expect(selectionStart).toBeGreaterThan(cardStart)
    expect(selectionEnd).toBeLessThan(actionStart)
  })

  it('redesigns Manual PDK Resources into category navigation plus selected-file detail view', () => {
    expect(source).toContain('PdkResourcePickerDialog')
    expect(source).toContain('pdkResourcePickerOpen')
    expect(source).toContain('pdk-manual-resource-shell')
    expect(source).toContain('pdk-resource-category-list')
    expect(source).toContain('pdk-resource-detail-panel')
    expect(source).toContain('pdk-resource-selected-list')
    expect(source).toContain('@click="activePdkWizardStep = item.key"')
    expect(source).toContain('displayPdkResourceName(file)')
    expect(source).toContain('Update selection')
    expect(source).toContain(':available-files="detectedPdkFiles[activePdkWizardStep]"')
    expect(source).toContain(':selected-files="pdkSelections[activePdkWizardStep]"')
    expect(source).toContain('@update:selected-files="updatePdkResourceSelection"')
    expect(source).toContain('detectedPdkDirectories')
    expect(source).toContain('scanManualPdkResources')
    expect(source).toContain('getCurrentPdkRoot')
    expect(source).toContain('getDesktopApi().workspace.scanPdkDirectory')
    expect(source).not.toContain('selectedManualPdkResourcePath')
    expect(source).not.toContain('Select a file to preview its full path.')
    expect(source).not.toContain('File Path')
    expect(source).not.toContain('PDK root')
    expect(source).not.toContain('Choose Files')
    expect(source).not.toContain('Add Files')
    expect(source).not.toContain('Detected Files')
  })

  it('keeps selected PDK resource files in an internal scroll list', () => {
    expect(source).toContain('pdk-resource-selected-list custom-scrollbar')
    const styleStart = source.indexOf('.pdk-resource-selected-list')
    const styleEnd = source.indexOf('.flow-step-connector', styleStart)
    const styleSource = source.slice(styleStart, styleEnd)

    expect(styleStart).toBeGreaterThan(-1)
    expect(styleSource).toContain('max-height:')
    expect(styleSource).toContain('overflow-y: auto')
    expect(styleSource).toContain('scrollbar-gutter: stable')
  })

  it('allows compressed and uncompressed design file imports', () => {
    expect(source).toContain(
      'Supports .v, .sv, .vhd, .vhdl, and .gz-compressed RTL files',
    )
    expect(source).toContain(
      'Please select RTL design files only (.v, .sv, .vhd, .vhdl, or .gz-compressed HDL).',
    )
    expect(source).toContain(
      "extensions: ['f', 'fl', 'flist', 'filelist', 'lst', 'txt', 'gz']",
    )
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
      'Origin Core Utilization',
      'Frequency max [MHz]',
      'Max Fanout',
    ]) {
      expect(source).toContain(label)
    }

    expect(source).toContain('dieAreaMode')
    expect(source).not.toContain('Core Margin')
    expect(source).not.toContain('Floorplan mode')
    expect(source).not.toContain('Placement Defaults')
    expect(source).not.toContain('Target Density')
    expect(source).not.toContain('Target Overflow')
  })
})
