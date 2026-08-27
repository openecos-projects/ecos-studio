import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'
import messageItemSource from './MessageItem.vue?raw'

describe('AIChatPanel flow contracts', () => {
  it('routes structured interactions through request id and dedicated answers', () => {
    expect(source).toContain("event.type === 'interaction'")
    expect(source).toContain('messageStore.upsertAgentEvent(event)')
    expect(source).toContain('messageStore.answerInteraction(')
    expect(source).toContain('agent.answerInteraction(request)')
  })

  it('renders centered turns with visually distinct user messages', () => {
    expect(source).toContain('groupMessagesIntoTurns')
    expect(source).toContain('conversationTurns')
    expect(source).toContain('chat-turn__user')
    expect(source).toContain('position: sticky')
    expect(source).toContain('v-for="msg in turn.responses"')
    expect(source).toContain('pendingInteractionPresentation(messages.value)')
    expect(source).toContain('turnIndex === conversationTurns.length - 1')
    expect(source).toContain('.chat-turn__body')
    expect(source).toContain('background: transparent')
    expect(source).toContain('text-align: left')
    expect(source).toContain('.chat-turn__user {\n  position: sticky')
    expect(source).toContain('display: block')
    expect(source).not.toContain('border-left: 2px solid')
    expect(source).not.toContain('var(--bg-sidebar) 82%')
    expect(source).toContain('var(--accent-color) 12%')
    expect(source).not.toContain('chat-turn__user-label')
    expect(source).not.toContain('chat-turn__agent-label')
  })

  it('lets messages follow the panel width while keeping Agent text unframed', () => {
    expect(source).not.toContain('max-width: 44rem')
    expect(messageItemSource).not.toContain('max-width: 70ch')
    expect(messageItemSource).not.toContain(
      'message-bubble--assistant rounded-lg border border-(--border-color) bg-(--bg-secondary)',
    )
  })

  it('anchors confirmed plans to their confirmation message', () => {
    expect(source).toContain('AgentSessionContractPanels')
    expect(source).toContain('mode="committed"')
    expect(source).toContain('mode="awaiting"')
    expect(source).toContain('v-for="msg in turn.responses"')
    expect(source).toContain(':message-id="msg.id"')
    expect(source).toContain('isVisibleResponse(msg)')
    expect(source).toContain('isAnsweredInteraction(msg)')
    expect(source).toContain('class="interaction-receipt"')
    expect(source).toContain('describeInteractionAnswer(interaction, answer)')
    expect(source).toContain('interactionCompanionIds')
    expect(source).toContain('v-if="isContractAnchorMessage(msg.id)"')
    expect(source).toContain('workspaceSetupAnchorMessageId')
    expect(source).toContain('markContractInteractionAnswered(sessionId, requestId)')
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

  it('docks interactions above the global composer and retains run controls', () => {
    expect(source).toContain('const pendingInteraction = computed(')
    expect(source).toContain('v-if="pendingInteraction"')
    expect(source).toContain('class="interaction-dock custom-scrollbar"')
    expect(source).toContain('<details')
    expect(source).toContain('class="interaction-dock__summary"')
    expect(source).toContain('syncInteractionExpanded')
    expect(source).toContain('@browse-rtl="browseInteractionRtl"')
    expect(source).toContain('desktopApi.dialog.pickRtlSources({')
    expect(source).toContain("return interaction.kind !== 'form'")
    expect(source).toContain('--interaction-dock-max-height: min(42vh, 28rem)')
    expect(source).toContain('class="interaction-dock__content custom-scrollbar"')
    expect(source).toContain(
      'max-height: calc(var(--interaction-dock-max-height) - 3rem)',
    )
    expect(source).toContain('overflow-y: auto')
    expect(source).not.toContain(
      'if (requestId !== previousRequestId) interactionExpanded.value = false',
    )
    expect(source).toContain(
      'if (sessionId !== previousSessionId) interactionExpanded.value = false',
    )
    expect(source).toContain('<AgentInteractionCard')
    expect(source).toContain('@undo="undoLastInteraction"')
    expect(source).toContain('aria-label="Undo last selection"')
    expect(source).toContain('v-else-if="undoInteraction && !isRunning"')
    expect(source).toMatch(
      /event\.type === 'workspace_create'[\s\S]*ui\.undoInteraction = undefined/,
    )
    expect(source).toContain('undo: true')
    expect(source).toContain('messageStore.rewindToInteraction(')
    expect(source).toContain('<div class="composer-footer">')
    expect(source).not.toContain('@other="focusComposer"')
    expect(source).not.toContain('composerInputRef.value?.focus()')
    expect(source).toContain('if (textMessage) messageStore.addMessage(textMessage)')
    expect(source).toContain(
      "textMessage ? '' : describeInteractionAnswer(interaction, answer)",
    )
    expect(source).toContain('Boolean(message.interactionAnswer)')
    expect(source).toContain('handleInteractionText')
    expect(source).toMatch(/\{ text: message \},\s*true/)
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
    expect(source).toContain("return 'Ask anything or reply…'")
    expect(source).toContain("return 'Ask anything…'")
    expect(source).toContain("return 'Connecting…'")
    expect(source).toContain("return 'Unavailable'")
    expect(source).not.toContain('Connecting to ECOS Agent')
    expect(source).not.toContain('ECOS Agent unavailable')
    expect(source).not.toContain('Message ECOS Agent')
  })

  it('sizes user messages to their content and wraps long text', () => {
    expect(source).toContain('width: fit-content')
    expect(source).toContain('max-width: min(82%, 52rem)')
    expect(source).toContain('overflow-wrap: anywhere')
  })

  it('overlays interactions without hiding the scrollable conversation tail', () => {
    expect(source).toContain('ref="interactionDockRef"')
    expect(source).toContain("'--interaction-overlay-height'")
    expect(source).toContain('interactionDockObserver = new ResizeObserver')
    expect(source).toContain('padding-bottom: var(--interaction-overlay-height, 0px)')
    expect(source).toContain('position: absolute')
    expect(source).toContain('bottom: 100%')
    expect(source).not.toContain('flex: 0 1 auto')
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

  it('clears the create trigger before reporting a post-create flow failure', () => {
    const start = source.indexOf('async function maybeRunPostCreateFlow')
    const end = source.indexOf('function handleAgentEvent', start)
    const postCreateFlow = source.slice(start, end)
    const failure = postCreateFlow.slice(postCreateFlow.indexOf('} catch (error)'))

    expect(failure.indexOf('ownerUi.workspaceCreateSetupId = undefined')).toBeGreaterThan(
      -1,
    )
    expect(failure.indexOf('ownerUi.workspaceCreateSetupId = undefined')).toBeLessThan(
      failure.indexOf("'failed'"),
    )
  })

  it('runs signoff inspection before path-based export and reports checklist blocking', () => {
    expect(source).toContain("event.type === 'workspace_signoff'")
    expect(source).toContain("ui.lastContractSurface = 'signoff'")
    expect(source).toContain("event.type === 'interaction'")
    expect(source).toContain('markContractInteractionAnswered(sessionId, requestId)')
    expect(source).toContain('inspectSignoff({ workspaceHandle })')
    expect(source).toContain("risk.severity === 'blocked'")
    expect(source).toContain('workspace_signoff_inspection:')
    expect(source).toContain('review.status')
    expect(source).toContain('ui.workspaceSignoffReview = review')
    expect(source).toContain('workspaceSignoffRows')
    expect(source).toContain('if (isWorkspaceSignoffPending.value)')
    expect(source).toContain("? 'Exporting' : 'Checking'")
    expect(source).toContain("contract.action === 'inspect'")
    expect(source).not.toContain('dialog.saveFile({')
    expect(source).toContain('workspaceSignoffOutputPath')
    expect(source).not.toContain('handleWorkspaceSignoffPathConfirm')
    expect(source).toContain('signoff/signoff_package.tar.gz')
    expect(source).toContain('exportSignoff({')
    expect(source).toContain('workspace_signoff_result:')
    expect(source).toContain("canExportSignoffPackage(flow) ? 'Harden'")
  })

  it('does not bind the signoff panel before a signoff event', () => {
    expect(source).not.toContain("workspaceSignoffTitle: 'Signoff package export'")
    expect(source).toContain(
      "activeUi.value.lastContractSurface === 'signoff' ? 'Signoff package export' : ''",
    )
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
    expect(source).not.toContain("label: 'Update workspace parameters'")
    expect(source).toContain('AgentChatTabStrip')
    expect(source).toContain('createChatTab')
    expect(source).toContain('directory: tab.workspacePath')
  })

  it('prevents replaying stale interactions after the conversation moves on', () => {
    expect(source).toContain('messageStore.answerInteraction(')
    expect(source).toContain('messageStore.restoreInteraction(requestId)')
  })

  it('shows elapsed turn activity while waiting for the next reply', () => {
    expect(source).toContain('showPendingPlaceholder')
    expect(source).toContain('class="agent-pending"')
    expect(source).toContain(':activity="pendingActivity"')
    expect(source).not.toContain('agent-pending__dot')
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
