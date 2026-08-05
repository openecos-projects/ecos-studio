import { describe, expect, it } from 'vitest'
import source from './AIChatPanel.vue?raw'

describe('AIChatPanel flow contracts', () => {
  it('routes structured choices through their prompt id and compatible option value', () => {
    expect(source).toContain("event.type === 'choice'")
    expect(source).toContain('messageStore.addChoice(event.choice, event.messageId)')
    expect(source).toContain('candidate.choice?.promptId === promptId')
    expect(source).toContain('await sendAgentMessage(option.value, false)')
    expect(source).toContain('messageStore.addMessage(option.label)')
  })

  it('renders Cursor-style full-width turns with sticky user nodes', () => {
    expect(source).toContain('groupMessagesIntoTurns')
    expect(source).toContain('conversationTurns')
    expect(source).toContain('chat-turn__user')
    expect(source).toContain('position: sticky')
    expect(source).toContain('v-for="msg in turn.responses"')
    expect(source).toContain('turnIndex === conversationTurns.length - 1')
  })

  it('keeps tool activity and streaming updates on the structured message path', () => {
    expect(source).toContain("event.type === 'message' || event.type === 'tool'")
    expect(source).toContain('messageStore.upsertAgentEvent(event)')
    expect(source).toContain('messageStore.finishStreamingMessages()')
  })

  it('locks choice-only input while retaining stop and one-message queue controls', () => {
    expect(source).toContain('activeChoice.value && !activeChoice.value.allowFreeText')
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
    expect(source).toContain(
      "activeChoice.value?.allowFreeText) return 'Enter a value, or choose an option above'",
    )
  })

  it('does not submit while an IME composition is active', () => {
    expect(source).toContain('if (e.isComposing) return')
  })

  it('maps validated provider contracts to structured messages', () => {
    expect(source).toContain("event.type === 'contract'")
    expect(source).toContain('addExecutionContract(event.contract)')
  })

  it('renders frozen rerun specifications in the same key-value table as workspace setup', () => {
    expect(source).toContain("event.contract.presentation === 'workspace_rerun'")
    expect(source).toContain('workspaceRerunContract.value = event.contract')
    expect(source).toMatch(
      /if \(event\.contract\.presentation === 'workspace_rerun'\) \{[\s\S]*workspaceRerunContract\.value = event\.contract[\s\S]*workspaceRerunMessage\.value = event\.text \?\? ''[\s\S]*lastContractSurface\.value = 'rerun'[\s\S]*scrollWorkspaceSetupIntoView\(\)[\s\S]*return\s*\}/,
    )
    expect(source).toContain('AgentExecutionContractPanel')
    expect(source).toContain(':rows="workspaceRerunRows"')
    expect(source).toContain('workspaceRerunExecutionState')
  })

  it('keeps workspace setup inside chat instead of reopening the native wizard', () => {
    expect(source).toContain("event.type === 'workspace_setup'")
    expect(source).toContain('AgentWorkspaceSetupPanel')
    expect(source).toContain('workspaceSetupContract.value = event.workspaceSetup')
    expect(source).not.toContain('openWorkspaceSetup?.(event.workspaceSetup)')
  })

  it('allows empty optional-path answers and executes only after confirmation', () => {
    expect(source).not.toContain('if (!message || !agent')
    expect(source).toContain("event.type === 'workspace_create'")
    expect(source).toContain('isWorkspaceCreationPending')
    expect(source).toContain('workspace_create_result:')
    expect(source).not.toContain('Workspace creation was not completed.')
    expect(source).toContain('workspaceSetupMessage.value = event.text')
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
      /const flowResult = await runAllFlow\(\{ rerun: false \}\)[\s\S]*await reportWorkspaceCreationResult\(handoff\.setupId, 'succeeded', ''\)/,
    )
  })

  it('prepares a validated workspace rerun without replacing the visible source workspace', () => {
    expect(source).toContain("event.type === 'workspace_rerun'")
    expect(source).toMatch(
      /event\.type === 'workspace_rerun'[\s\S]*workspaceRerunToken[\s\S]*scrollWorkspaceSetupIntoView\(\)[\s\S]*void executeWorkspaceRerun/,
    )
    expect(source).toContain(
      'event.text ?? `Rerun ${event.workspaceRerun.rerun_id} accepted.`',
    )
    expect(source).toContain('prepareFlowAgentRerun')
    expect(source).toContain('event.workspaceRerunToken')
    expect(source).toContain(
      'await desktopApi.workspace.bindWindow(contract.source_workspace)',
    )
    expect(source).not.toContain('path: contract.source_workspace')
    expect(source).not.toContain('const sourceOpened =')
    expect(source).toContain('prepareRerun({ token })')
    expect(source).toContain('workspace_rerun_result:')
    expect(source).toContain('await desktopApi.workspace.bindWindow(prepared.directory)')
    expect(source).toMatch(
      /await agentFlowProgress\.start\(prepared\.directory\)[\s\S]*await executeRerun/,
    )
    expect(source).toContain('executeRerun({ token: prepared.executionToken })')
    expect(source).toContain("appendToolProgress('Preparing isolated rerun workspace.')")
    expect(source).toContain("appendToolProgress('Opening isolated rerun workspace.')")
    expect(source).toContain("appendToolProgress('Starting rerun execution.')")
    expect(source).toContain('finishToolProgress()')
    expect(source).toContain('`Rerun failed: ${reason}`')
  })

  it('routes live flow progress into the tool timeline instead of plain assistant text', () => {
    expect(source).toContain('messageStore.appendToolProgress(message)')
    expect(source).toContain('messageStore.finishToolProgress()')
    expect(source).toContain("message.startsWith('Live flow progress is unavailable')")
  })

  it('starts sessions with projectRoot and known project history', () => {
    expect(source).toContain('loadProjectHistory()')
    expect(source).toContain('knownProjects')
    expect(source).toContain('projectRoot')
    expect(source).toContain('route.query.projectRoot')
    expect(source).toContain('Create another workspace in this project')
  })
})

