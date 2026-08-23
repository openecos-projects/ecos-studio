import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'

describe('AIChatPanel flow contracts', () => {
  it('keeps slash commands in the same Agent Chat provider session', () => {
    expect(source).not.toContain('codexCliTerminal')
    expect(source).not.toContain('sendCodexCliInput')
    expect(source).not.toContain('toggleCodexCliMode')
    expect(source).toContain('await sendAgentMessage(message)')
  })

  it('separates manual workspace setup from bounded optimization on the home screen', () => {
    expect(source).toContain(
      "label: 'Start creating a Workspace and run a full RTL-to-GDS flow'",
    )
    expect(source).toContain("label: 'Start a bounded optimization episode'")
    expect(source).toContain("value: '2'")
  })

  it('routes structured choices through their prompt id and compatible option value', () => {
    expect(source).toContain("event.type === 'choice'")
    expect(source).toContain(
      'messageStore.addChoice(event.choice, event.messageId, event.sessionId)',
    )
    expect(source).toContain('candidate.choice?.promptId === promptId')
    expect(source).toContain('await sendAgentMessage(option.value, false)')
    expect(source).toContain('messageStore.addMessage(choiceSelectionText(option))')
  })

  it('renders Cursor-style centered turns with sticky user cards', () => {
    expect(source).toContain('groupMessagesIntoTurns')
    expect(source).toContain('conversationTurns')
    expect(source).toContain('chat-turn__user')
    expect(source).toContain('position: sticky')
    expect(source).toContain('v-for="msg in turn.responses"')
    expect(source).toContain('turnIndex === conversationTurns.length - 1')
    expect(source).toContain('.chat-turn__body')
    expect(source).toContain('background: transparent')
    expect(source).toContain('margin-inline: auto')
    expect(source).toContain('text-align: left')
    expect(source).toContain('.chat-turn__user {\n  position: sticky')
    expect(source).toContain('display: block')
    expect(source).not.toContain('border-left: 2px solid')
    expect(source).not.toContain('var(--bg-sidebar) 82%')
  })

  it('keeps confirmed run plans above progress and awaiting plans after Q&A', () => {
    expect(source).toContain('AgentSessionContractPanels')
    expect(source).toContain('mode="committed"')
    expect(source).toContain('mode="awaiting"')
    expect(source.indexOf('mode="committed"')).toBeLessThan(
      source.indexOf('v-for="msg in turn.responses"'),
    )
    expect(source.indexOf('v-for="msg in turn.responses"')).toBeLessThan(
      source.indexOf('mode="awaiting"'),
    )
    expect(source).toContain('activeUi.value.workspaceSetupAnchorTurnId = turnId')
  })

  it('keeps tool activity and streaming updates on the structured message path', () => {
    expect(source).toContain("event.type === 'message' || event.type === 'tool'")
    expect(source).toContain('messageStore.upsertAgentEvent(event)')
    expect(source).toContain('messageStore.finishStreamingMessages(event.sessionId)')
  })

  it('keeps the transcript pinned while tool progress content grows in place', () => {
    expect(source).toContain('const stickToBottom = ref(true)')
    expect(source).toContain('@scroll.passive="onScrollContainerScroll"')
    expect(source).toContain('last?.content.length ?? 0')
    expect(source).toContain('bindScrollContentObserver()')
    expect(source).toContain('scrollToBottomIfNeeded(force, false)')
  })

  it('keeps the composer open during choices while retaining stop and one-message queue controls', () => {
    expect(source).toContain(
      'const composerLocked = computed(() => isInterruptPending.value || !agentSessionId.value)',
    )
    expect(source).not.toContain(
      'activeChoice.value && !activeChoice.value.allowFreeText',
    )
    expect(source).toContain('if (isRunning.value) {')
    expect(source).toContain('queuedMessage.value = message')
    expect(source).toContain('watch(isRunning')
    expect(source).toContain('void flushQueuedMessage()')
    expect(source).toContain('const canSubmit = computed(')
    expect(source).toContain(':disabled="!canSubmit"')
    expect(source).toContain('isAgentConnecting.value')
    expect(source).toContain('!agentSessionId.value')
    expect(source).toContain(
      'await agent.interrupt({ providerId: AGENT_PROVIDER_ID, sessionId })',
    )
    expect(source).toContain('v-if="isRunning"')
    expect(source).toContain('class="stop-btn"')
    expect(source).toContain('@click="interruptAgent"')
    expect(source).toContain('composer-sr-status')
    expect(source).not.toContain('run-status-dot')
    expect(source).toContain('@click="cancelQueuedMessage"')
    expect(source).toContain("return 'Add a follow-up…'")
    expect(source).toContain('Enter a value, or choose above')
    expect(source).toContain("activeChoice.value.variant === 'buttons'")
    expect(source).toContain(
      "if (activeChoice.value) return 'Ask anything, or choose above'",
    )
    expect(source).toContain("return 'Ask anything…'")
    expect(source).toContain("return 'Connecting…'")
    expect(source).toContain("return 'Unavailable'")
    expect(source).not.toContain('Connecting to ECOS Agent')
    expect(source).not.toContain('ECOS Agent unavailable')
    expect(source).not.toContain('Message ECOS Agent')
  })

  it('does not submit while an IME composition is active', () => {
    expect(source).toContain('if (e.isComposing) return')
  })

  it('navigates current-session text input history with the arrow keys', () => {
    expect(source).toContain("message.role === 'user' && message.type === 'text'")
    expect(source).toContain('@input="resetInputHistory"')
    expect(source).toContain("e.key === 'ArrowUp' || e.key === 'ArrowDown'")
    expect(source).toContain(
      'navigateInputHistory(activeUi.value, userInputHistory.value, direction)',
    )
  })

  it('maps validated provider contracts to structured messages', () => {
    expect(source).toContain("event.type === 'contract'")
    expect(source).toContain('addExecutionContract(event.contract, event.sessionId)')
  })

  it('renders frozen rerun specifications in the same key-value table as workspace setup', () => {
    expect(source).toContain("event.contract.presentation === 'workspace_rerun'")
    expect(source).toContain('ui.workspaceRerunContract = event.contract')
    expect(source).toMatch(
      /if \(event\.contract\.presentation === 'workspace_rerun'\) \{[\s\S]*ui\.workspaceRerunContract = event\.contract[\s\S]*ui\.workspaceRerunMessage = event\.text \?\? ''[\s\S]*ui\.lastContractSurface = 'rerun'/,
    )
    expect(source).toContain('AgentSessionContractPanels')
    expect(source).toContain('workspaceRerunRows:')
    expect(source).toContain('workspaceRerunExecutionState')
  })

  it('keeps workspace setup inside chat instead of reopening the native wizard', () => {
    expect(source).toContain("event.type === 'workspace_setup'")
    expect(source).toContain('AgentSessionContractPanels')
    expect(source).toContain('ui.workspaceSetupContract = event.workspaceSetup')
    expect(source).not.toContain('openWorkspaceSetup?.(event.workspaceSetup)')
  })

  it('allows empty optional-path answers and executes only after confirmation', () => {
    expect(source).not.toContain('if (!message || !agent')
    expect(source).toContain("event.type === 'workspace_create'")
    expect(source).toContain('isWorkspaceCreationPending')
    expect(source).toContain('workspace_create_result:')
    expect(source).toContain('createAgentWorkspace(config, contract, ownerSessionId)')
    expect(source).toContain('ui.workspaceSetupStartedId === contract.setup_id')
    expect(source).toContain('ui.workspaceSetupStartedId = contract.setup_id')
    expect(source).toContain('handoff.ownerSessionId')
    expect(source).not.toContain('Workspace creation was not completed.')
    expect(source).toContain('ui.workspaceSetupMessage = event.text')
    expect(source).toContain('scrollWorkspaceSetupIntoView()')
    expect(source).not.toContain(
      "if (event.text) messageStore.addAssistantMessage(event.text, 'done')",
    )
    expect(source).toContain('maybeRunPostCreateFlow')
    expect(source).toContain('takePendingPostCreateFlow')
    expect(source).toContain('const flowResult = await runAllFlow({ rerun: false })')
    expect(source).toContain(
      "throw new Error('Flow execution did not complete successfully.')",
    )
    expect(source).toMatch(
      /const flowResult = await runAllFlow\(\{ rerun: false \}\)[\s\S]*await reportWorkspaceCreationResult\([\s\S]*handoff\.setupId,[\s\S]*'succeeded',[\s\S]*handoff\.ownerSessionId/,
    )
  })

  it('runs signoff inspection before path-based export and reports checklist blocking', () => {
    expect(source).toContain("event.type === 'workspace_signoff'")
    expect(source).toContain("ui.lastContractSurface = 'signoff'")
    expect(source).toContain('workspaceSignoffChoice')
    expect(source).toContain('@signoff-select="handleWorkspaceSignoffChoice"')
    expect(source).toContain("submitChoice(option, 'signoff')")
    expect(source).toContain('inspectSignoff({ workspaceHandle })')
    expect(source).toContain("risk.severity === 'blocked'")
    expect(source).toContain('workspace_signoff_inspection:')
    expect(source).toContain('review.status')
    expect(source).toContain("contract.action === 'inspect'")
    expect(source).not.toContain('dialog.saveFile({')
    expect(source).toContain('workspaceSignoffOutputPath')
    expect(source).toContain('handleWorkspaceSignoffPathConfirm')
    expect(source).toContain('Enter a signoff package output path.')
    expect(source).toContain('exportSignoff({')
    expect(source).toContain('workspace_signoff_result:')
    expect(source).toContain("canExportSignoffPackage(flow) ? 'Harden'")
  })

  it('applies parameter updates from the contract instead of a local knob table', () => {
    // A second mapping here silently dropped every knob it did not know about.
    expect(source).not.toContain('applyParameterPatchToParametersJson')
    expect(source).not.toContain("'place.target_density': 'Target density'")
    expect(source).toContain(
      "invalidateWorkspaceResources(['parameters', 'home', 'step-config', 'flow'])",
    )
    expect(source).toContain(
      'applyWorkspaceParameterWrites(workspaceRoot, contract.writes)',
    )
    expect(source).toContain('for (const write of fileWrites)')
    expect(source).toContain('setJsonPathValue(document, write)')
    expect(source).toContain(
      'throw new Error(`Parameter ${write.knob_id} does not exist in ${write.file}.`)',
    )
  })

  it('pushes parameter writes back through ECC so the next run sees them', () => {
    expect(source).toContain(
      'syncWorkspaceParameterWrites(workspaceRoot, contract.writes)',
    )
    expect(source).toContain('cmd: CMDEnum.sync_config')
    expect(source).toContain('cmd: CMDEnum.refresh_config')
    // sync_config must run first: refresh_config re-expands parameters.json over
    // the step configs and would discard an unsynced step-config edit.
    expect(source.indexOf('cmd: CMDEnum.sync_config')).toBeLessThan(
      source.indexOf('cmd: CMDEnum.refresh_config'),
    )
    expect(source).toContain('assertEccSuccess(')
    expect(source).toContain(
      "throw new Error('The parameter update targets a workspace that is not open.')",
    )
  })

  it('writes parameter files with the indentation they already use', () => {
    expect(source).not.toContain('JSON.stringify(parameters, null, 2)')
    expect(source).toContain('JSON.stringify(document, null, detectJsonIndent(raw))')
    expect(source).toContain("raw.endsWith('\\n') ? `${serialized}\\n` : serialized")
  })

  it('opens the rerun workspace and restores the source workspace on failure', () => {
    expect(source).toContain("event.type === 'workspace_rerun'")
    expect(source).toContain('void executeWorkspaceRerun(')
    expect(source).toContain(
      'event.text ?? `Rerun ${event.workspaceRerun.rerun_id} accepted.`',
    )
    expect(source).toContain('prepareFlowAgentRerun')
    expect(source).toContain('event.workspaceRerunToken')
    expect(source).toContain(
      'await desktopApi.workspace.bindWindow(contract.source_workspace)',
    )
    expect(source).toContain('Restored the source workspace after the rerun failed.')
    expect(source).toContain('path: contract.source_workspace')
    expect(source).toContain('const restored = await openProject({')
    expect(source).toContain(
      "throw new Error('The source workspace could not be reopened.')",
    )
    expect(source).not.toContain('const sourceOpened =')
    expect(source).toContain('prepareRerun({ token })')
    expect(source).toContain('workspace_rerun_result:')
    expect(source).toContain('await desktopApi.workspace.bindWindow(prepared.directory)')
    expect(source).toMatch(
      /const opened = await openProject\([\s\S]*const projectContext = await registerAgentRerunWorkspaceInProject\([\s\S]*await router\.push\(\{[\s\S]*projectRoot: projectContext\?\.projectRoot[\s\S]*await nextTick\(\)[\s\S]*invalidateWorkspaceResources\(\['home', 'flow', 'step', 'maps', 'logs', 'parameters'\]\)[\s\S]*await agentFlowProgress\.start\(prepared\.directory\)[\s\S]*await executeRerun/,
    )
    expect(source).toContain('executeRerun({ token: prepared.executionToken })')
    expect(source).toContain('markAgentWorkspaceRerunHomePrepared(prepared.directory)')
    expect(source).not.toContain('requestHomeRunArtifactReset(prepared.directory)')
    expect(source).toContain('registerAgentRerunWorkspaceInProject(')
    expect(source).toContain('registerProjectManagedWorkspace({')
    expect(source).toContain('resolveManagedProjectContext({')
    expect(source).toContain(
      'const projectContext = await registerAgentRerunWorkspaceInProject(',
    )
    expect(source).toContain('projectRoot: projectContext?.projectRoot')
    expect(source).toContain('projectName: projectContext?.projectName')
    expect(source).toContain(
      "invalidateWorkspaceResources(['flow', 'step', 'maps', 'logs'])",
    )
    expect(source).toContain(
      "invalidateWorkspaceResources(['home', 'flow', 'step', 'maps', 'logs', 'parameters'])",
    )
    expect(source).toContain(
      "appendToolProgress('Preparing isolated rerun workspace.', ownerSessionId)",
    )
    expect(source).toContain(
      "appendToolProgress('Opening isolated rerun workspace.', ownerSessionId)",
    )
    expect(source).toContain(
      "appendToolProgress('Starting rerun execution.', ownerSessionId)",
    )
    expect(source).toContain('finishToolProgress(ownerSessionId)')
    expect(source).toContain('`Rerun failed: ${reason}`')
  })

  it('routes live flow progress into the tool timeline instead of plain assistant text', () => {
    expect(source).toContain('messageStore.appendToolProgress(message')
    expect(source).toContain('messageStore.finishToolProgress()')
    expect(source).toContain("message.startsWith('Live flow progress is unavailable')")
  })

  it('starts sessions with projectRoot and known project history', () => {
    expect(source).toContain('loadProjectHistory()')
    expect(source).toContain('knownProjects')
    expect(source).toContain('projectRoot')
    expect(source).toContain('route.query.projectRoot')
    expect(source).toContain('Create another workspace in this project')
    expect(source).toContain('AgentChatTabStrip')
    expect(source).toContain('createChatTab')
    expect(source).toContain('directory: tab.workspacePath')
  })

  it('prevents replaying stale choice cards after the conversation moves on', () => {
    expect(source).toContain('messageStore.dismissOpenChoices()')
    expect(source).toContain('activeChoicePromptId')
    expect(source).toContain(
      ':choice-interactive="msg.choice?.promptId === activeChoicePromptId"',
    )
    expect(source).toContain(
      'if (activeChoicePromptId.value && activeChoicePromptId.value !== promptId) return',
    )
  })

  it('shows a quiet pending cue while waiting for the next reply', () => {
    expect(source).toContain('showPendingPlaceholder')
    expect(source).toContain('class="agent-pending"')
    expect(source).toContain('agent-pending__dot')
    expect(source).not.toContain('Agent is working…')
    expect(source).not.toContain("'Thinking'")
  })

  it('defers GUI-driving actions when the owning tab is not active', () => {
    expect(source).toContain('isActiveGuiOwner')
    expect(source).toContain('deferGuiAction')
    expect(source).toContain('GUI_SWITCH_PROMPT')
    expect(source).toContain('flushPendingGuiActionForActiveTab')
  })
})
