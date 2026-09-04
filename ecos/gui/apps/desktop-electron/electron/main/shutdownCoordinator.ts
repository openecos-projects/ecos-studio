import { randomUUID } from 'node:crypto'
import type {
  DesktopShutdownStatus,
  EccBackgroundOperation,
  EccBackgroundOperationProjection,
  EccBackgroundWorkspaceCreation,
} from '@ecos-studio/shared'
import {
  boundedShutdownIssue,
  buildShutdownBlockers,
  emptyShutdownBlockers,
  hasShutdownBlockers,
  idleShutdownStatus,
  workspaceHandlesInShutdownScope,
  type ShutdownBlockerSummary,
  type ShutdownScope,
} from './shutdownBlockers'
import { ShutdownAcceptedWork } from './shutdownAcceptedWork'

interface ShutdownCoordinatorOptions {
  approve(scope: ShutdownScope): void | Promise<void>
  cancelOperation(workspaceHandle: string, operationId: string): Promise<unknown>
  creationEntries?(): Promise<EccBackgroundWorkspaceCreation[]>
  currentOperationProjection?(): EccBackgroundOperationProjection
  forceTerminate(workspaceHandles?: readonly string[]): Promise<void>
  flushRuntimeState?(): Promise<void>
  listWindowIds(): number[]
  markCreationsUnfinished(windowIds?: ReadonlySet<number>): Promise<void>
  operationProjection():
    | EccBackgroundOperationProjection
    | Promise<EccBackgroundOperationProjection>
  promptForce(
    blockers: ShutdownBlockerSummary,
  ): Promise<'keep-waiting' | 'cancel' | 'force'>
  promptInitial(blockers: ShutdownBlockerSummary): Promise<'wait' | 'cancel'>
  requestRendererCleanup(attemptId: string, windowIds: number[]): void
  waitForRuntimeIdle?(workspaceHandles?: readonly string[]): Promise<void>
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}

interface Attempt {
  id: string
  forceEligible: boolean
  initialPromptOpen: boolean
  pendingCleanup: Set<number>
  scope: ShutdownScope
  state: DesktopShutdownStatus['state']
  blockers: ShutdownBlockerSummary
  issue?: string
  forceCleanupResolve?: () => void
}

export class ShutdownCoordinator {
  private attempt: Attempt | null = null
  private readonly acceptedWork = new ShutdownAcceptedWork()
  private readonly handleOwners = new Map<string, number>()
  private readonly listeners = new Set<(status: DesktopShutdownStatus) => void>()
  private forceTimer: ReturnType<typeof setTimeout> | null = null
  private forcePromptOpen = false
  private applicationApproved = false
  private readonly approvedWindows = new Set<number>()

  constructor(private readonly options: ShutdownCoordinatorOptions) {}

  trackWorkspaceHandle(windowId: number, workspaceHandle: string): void {
    this.handleOwners.set(workspaceHandle, windowId)
  }

  untrackWorkspaceHandle(workspaceHandle: string): void {
    this.handleOwners.delete(workspaceHandle)
  }

  beginAcceptedWork(windowId: number): () => void {
    return this.acceptedWork.begin(windowId, () => {
      void this.notifyBlockersChanged()
    })
  }

  windowClosed(windowId: number): void {
    this.approvedWindows.delete(windowId)
    if (
      this.attempt?.scope.kind === 'window' &&
      this.attempt.scope.windowId === windowId
    ) {
      this.clearForceTimer()
      this.attempt = null
      this.emit()
    }
  }

  isApplicationApproved(): boolean {
    return this.applicationApproved
  }

  isWindowApproved(windowId: number): boolean {
    return this.approvedWindows.has(windowId)
  }

  isMutationBlocked(windowId: number): boolean {
    if (
      !this.attempt ||
      !['draining', 'force-eligible', 'cleaning-renderers', 'forcing', 'error'].includes(
        this.attempt.state,
      )
    )
      return false
    return (
      this.attempt.scope.kind === 'application' ||
      this.attempt.scope.windowId === windowId
    )
  }

  onStatusChanged(listener: (status: DesktopShutdownStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  status(): DesktopShutdownStatus {
    const attempt = this.attempt
    const blockers = attempt?.blockers ?? emptyShutdownBlockers()
    return {
      activeFlows: blockers.activeFlows,
      attemptId: attempt?.id ?? null,
      finalizations: blockers.finalizations,
      forceEligible: attempt?.forceEligible ?? false,
      ...(attempt?.issue ? { issue: attempt.issue } : {}),
      pendingCommands: blockers.pendingCommands,
      pendingCreations: blockers.pendingCreations,
      scope: attempt?.scope.kind ?? null,
      snapshotFailures: blockers.snapshotFailures,
      state: attempt?.state ?? 'idle',
    }
  }

  statusForWindow(windowId: number): DesktopShutdownStatus {
    if (
      !this.attempt ||
      this.attempt.scope.kind === 'application' ||
      this.attempt.scope.windowId === windowId
    ) {
      return this.status()
    }
    return idleShutdownStatus()
  }

  scope(): ShutdownScope {
    return this.attempt?.scope ?? { kind: 'application' }
  }

  requestWindowClose(windowId: number): Promise<void> {
    return this.request({ kind: 'window', windowId })
  }

  requestApplicationQuit(): Promise<void> {
    return this.request({ kind: 'application' })
  }

  async notifyBlockersChanged(): Promise<void> {
    const attempt = this.attempt
    if (!attempt || !['draining', 'force-eligible', 'error'].includes(attempt.state))
      return
    const blockers = await this.inspect(attempt.scope)
    if (this.attempt !== attempt) return
    attempt.blockers = blockers
    this.emit()
    if (!hasShutdownBlockers(blockers)) {
      await this.beginRendererCleanup()
    }
  }

  async completeRendererCleanup(
    attemptId: string,
    windowId: number,
    ok: boolean,
    issue?: string,
  ): Promise<void> {
    const attempt = this.attempt
    if (!attempt || attempt.id !== attemptId) return
    if (attempt.state === 'forcing') {
      if (!attempt.pendingCleanup.delete(windowId)) return
      if (!attempt.pendingCleanup.size) attempt.forceCleanupResolve?.()
      return
    }
    if (attempt.state !== 'cleaning-renderers') return
    if (!attempt.pendingCleanup.has(windowId)) return
    if (!ok) {
      attempt.state = 'error'
      attempt.issue = boundedShutdownIssue(issue || 'Renderer cleanup failed.')
      this.emit()
      return
    }
    attempt.pendingCleanup.delete(windowId)
    if (attempt.pendingCleanup.size > 0) return
    const blockers = await this.inspect(attempt.scope)
    if (this.attempt !== attempt || attempt.state !== 'cleaning-renderers') return
    attempt.blockers = blockers
    if (hasShutdownBlockers(attempt.blockers)) {
      this.enterDraining()
      return
    }
    await this.approve()
  }

  cancelShutdown(): void {
    if (this.attempt?.state === 'forcing' || this.attempt?.state === 'approved') return
    this.clearForceTimer()
    this.attempt = null
    this.forcePromptOpen = false
    this.emit()
  }

  async reviewShutdownOptions(): Promise<void> {
    const attempt = this.attempt
    if (!attempt) return
    if (attempt.state === 'error') {
      const blockers = await this.inspect(attempt.scope)
      if (this.attempt !== attempt || attempt.state !== 'error') return
      attempt.blockers = blockers
      if (!hasShutdownBlockers(blockers)) {
        await this.beginRendererCleanup()
      } else {
        attempt.state = attempt.forceEligible ? 'force-eligible' : 'draining'
        attempt.issue = undefined
        this.emit()
      }
    }
    if (attempt.forceEligible) await this.showForcePrompt()
  }

  private async request(scope: ShutdownScope): Promise<void> {
    let attempt = this.attempt
    if (attempt) {
      if (scope.kind === 'application' && attempt.scope.kind === 'window') {
        attempt.scope = scope
        attempt.blockers = await this.inspect(scope)
        if (this.attempt !== attempt) return
        if (attempt.state === 'cleaning-renderers') {
          const windowIds = this.options.listWindowIds()
          attempt.pendingCleanup = new Set(windowIds)
          this.options.requestRendererCleanup(attempt.id, windowIds)
        }
        this.emit()
      }
      if (attempt.state === 'error') {
        await this.reviewShutdownOptions()
        return
      }
      if (attempt.forceEligible) {
        await this.showForcePrompt()
        return
      }
      if (attempt.state !== 'idle') return
    } else {
      attempt = {
        blockers: emptyShutdownBlockers(),
        forceEligible: false,
        id: randomUUID(),
        initialPromptOpen: false,
        pendingCleanup: new Set(),
        scope,
        state: 'idle',
      }
      this.attempt = attempt
    }
    await this.resolveInitialDecision(attempt)
  }

  private async resolveInitialDecision(attempt: Attempt): Promise<void> {
    const inspectedScope = attempt.scope
    const blockers = await this.inspect(inspectedScope)
    if (this.attempt !== attempt || attempt.state !== 'idle') return
    if (attempt.scope !== inspectedScope) {
      await this.resolveInitialDecision(attempt)
      return
    }
    attempt.blockers = blockers
    if (!hasShutdownBlockers(blockers)) {
      await this.beginRendererCleanup()
      return
    }
    if (attempt.initialPromptOpen) return
    attempt.initialPromptOpen = true
    try {
      if ((await this.options.promptInitial(blockers)) === 'cancel') {
        if (this.attempt === attempt) this.cancelShutdown()
        return
      }
    } finally {
      attempt.initialPromptOpen = false
    }
    if (this.attempt !== attempt || attempt.state !== 'idle') return
    this.enterDraining()
  }

  private enterDraining(): void {
    if (!this.attempt) return
    this.attempt.state = 'draining'
    this.attempt.issue = undefined
    this.emit()
    this.scheduleForceEligibility()
  }

  private scheduleForceEligibility(): void {
    if (this.forceTimer || this.attempt?.forceEligible) return
    const schedule = this.options.setTimeout ?? setTimeout
    this.forceTimer = schedule(() => {
      this.forceTimer = null
      void this.enableForceQuit()
    }, 30_000)
  }

  private async enableForceQuit(): Promise<void> {
    const attempt = this.attempt
    if (!attempt || !['draining', 'cleaning-renderers', 'error'].includes(attempt.state))
      return
    const blockers = await this.inspect(attempt.scope)
    if (this.attempt !== attempt) return
    attempt.blockers = blockers
    if (!hasShutdownBlockers(blockers) && attempt.state !== 'cleaning-renderers') {
      await this.beginRendererCleanup()
    }
    if (this.attempt !== attempt || attempt.state === 'approved') return
    attempt.forceEligible = true
    if (attempt.state === 'draining') attempt.state = 'force-eligible'
    this.emit()
    await this.showForcePrompt()
  }

  private async showForcePrompt(): Promise<void> {
    const attempt = this.attempt
    if (!attempt?.forceEligible || this.forcePromptOpen) return
    this.forcePromptOpen = true
    try {
      const result = await this.options.promptForce(attempt.blockers)
      if (
        this.attempt !== attempt ||
        !attempt.forceEligible ||
        attempt.state === 'approved'
      )
        return
      if (result === 'cancel') this.cancelShutdown()
      else if (result === 'force') await this.forceQuit()
    } finally {
      this.forcePromptOpen = false
    }
  }

  private async forceQuit(): Promise<void> {
    const attempt = this.attempt
    if (!attempt) return
    attempt.state = 'forcing'
    attempt.blockers = await this.inspect(attempt.scope)
    this.emit()
    try {
      await this.options.markCreationsUnfinished(this.windowScope(attempt.scope))
    } catch (error) {
      attempt.state = 'error'
      attempt.issue = boundedShutdownIssue(
        error instanceof Error ? error.message : String(error),
      )
      this.emit()
      return
    }

    const projection =
      this.options.currentOperationProjection?.() ??
      (await this.options.operationProjection())
    const operations = this.operationsInScope(
      projection.operations,
      attempt.scope,
    ).filter(
      (operation) =>
        operation.interruptibility !== 'deferred' &&
        operation.interruptibility !== 'forbidden',
    )
    const windowIds =
      attempt.scope.kind === 'application'
        ? this.options.listWindowIds()
        : attempt.scope.windowId === undefined
          ? []
          : [attempt.scope.windowId]
    attempt.pendingCleanup = new Set(windowIds)
    const rendererCleanup = new Promise<void>((resolve) => {
      attempt.forceCleanupResolve = resolve
      if (!windowIds.length) resolve()
    })
    this.options.requestRendererCleanup(attempt.id, windowIds)
    const workspaceHandles = workspaceHandlesInShutdownScope(
      this.handleOwners,
      attempt.scope,
    )
    const backendQuiescence = Promise.allSettled(
      operations.map((operation) =>
        this.options.cancelOperation(operation.workspaceHandle, operation.operationId),
      ),
    ).then(() =>
      Promise.all([
        this.acceptedWork
          .wait(attempt.scope)
          .then(() => this.options.flushRuntimeState?.()),
        this.options.waitForRuntimeIdle?.(workspaceHandles),
      ]),
    )
    const bestEffort = Promise.all([rendererCleanup, backendQuiescence])
    const schedule = this.options.setTimeout ?? setTimeout
    let deadline: ReturnType<typeof setTimeout> | null = null
    try {
      await Promise.race([
        bestEffort,
        new Promise<void>((resolve) => {
          deadline = schedule(resolve, 3_000)
        }),
      ])
    } finally {
      if (deadline) (this.options.clearTimeout ?? clearTimeout)(deadline)
    }
    await this.options.forceTerminate(workspaceHandles)
    await this.approve()
  }

  private async beginRendererCleanup(): Promise<void> {
    const attempt = this.attempt
    if (!attempt || attempt.state === 'cleaning-renderers') return
    this.scheduleForceEligibility()
    const windowIds =
      attempt.scope.kind === 'application'
        ? this.options.listWindowIds()
        : attempt.scope.windowId === undefined
          ? []
          : [attempt.scope.windowId]
    attempt.state = 'cleaning-renderers'
    attempt.pendingCleanup = new Set(windowIds)
    this.emit()
    if (!windowIds.length) {
      await this.approve()
      return
    }
    this.options.requestRendererCleanup(attempt.id, windowIds)
  }

  private async approve(): Promise<void> {
    const attempt = this.attempt
    if (!attempt || attempt.state === 'approved') return
    this.clearForceTimer()
    attempt.forceEligible = false
    attempt.state = 'approved'
    if (attempt.scope.kind === 'application') this.applicationApproved = true
    else if (attempt.scope.windowId !== undefined)
      this.approvedWindows.add(attempt.scope.windowId)
    this.emit()
    await this.options.approve(attempt.scope)
  }

  private async inspect(scope: ShutdownScope): Promise<ShutdownBlockerSummary> {
    const projection = await this.options.operationProjection()
    const creations = (await this.options.creationEntries?.()) ?? projection.creations
    return buildShutdownBlockers({
      acceptedWorkByWindow: this.acceptedWork.counts,
      creations,
      handleOwners: this.handleOwners,
      projection,
      scope,
    })
  }

  private operationsInScope(
    operations: EccBackgroundOperation[],
    scope: ShutdownScope,
  ): EccBackgroundOperation[] {
    return operations.filter((operation) =>
      this.inScope(operation.workspaceHandle, scope),
    )
  }

  private inScope(workspaceHandle: string, scope: ShutdownScope): boolean {
    return (
      scope.kind === 'application' ||
      this.handleOwners.get(workspaceHandle) === scope.windowId
    )
  }

  private windowScope(scope: ShutdownScope): ReadonlySet<number> | undefined {
    return scope.kind === 'application' || scope.windowId === undefined
      ? undefined
      : new Set([scope.windowId])
  }

  private clearForceTimer(): void {
    if (!this.forceTimer) return
    ;(this.options.clearTimeout ?? clearTimeout)(this.forceTimer)
    this.forceTimer = null
  }

  private emit(): void {
    const status = this.status()
    for (const listener of this.listeners) listener(status)
  }
}
