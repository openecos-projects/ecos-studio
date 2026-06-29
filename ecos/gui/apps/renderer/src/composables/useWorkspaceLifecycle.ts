import { computed, ref } from 'vue'

export const WORKSPACE_INVALIDATION_SCOPES = [
  'home',
  'flow',
  'parameters',
  'step',
  'step-config',
  'maps',
  'logs',
  'all',
] as const

export type WorkspaceInvalidationScope = typeof WORKSPACE_INVALIDATION_SCOPES[number]

export type WorkspaceSessionState =
  | 'idle'
  | 'validating'
  | 'loading'
  | 'active'
  | 'switching'
  | 'closing'
  | 'failed'

export type WorkspaceResourceVersions = Record<WorkspaceInvalidationScope, number>

export interface WorkspaceSession {
  sessionId: string
  workspaceId: string
  projectRoot: string
  state: WorkspaceSessionState
  resourceVersions: WorkspaceResourceVersions
}

export interface WorkspaceSessionInput {
  workspaceId?: string
  projectRoot?: string
}

export interface WorkspaceCleanupOptions {
  sessionId?: string
  label?: string
}

export interface WorkspaceInvalidationOptions {
  reason?: string
  step?: string
  sessionId?: string
}

type WorkspaceCleanup = () => void

interface WorkspaceCleanupRecord {
  id: number
  sessionId: string
  label: string
  cleanup: WorkspaceCleanup
}

interface WorkspaceBlobRecord {
  url: string
  sessionId: string
}

let sessionSequence = 0
let cleanupSequence = 0

function nextSessionId(): string {
  sessionSequence += 1
  return `renderer-workspace-session-${sessionSequence}`
}

function createResourceVersions(): WorkspaceResourceVersions {
  return {
    home: 0,
    flow: 0,
    parameters: 0,
    step: 0,
    'step-config': 0,
    maps: 0,
    logs: 0,
    all: 0,
  }
}

const resourceVersions = ref<WorkspaceResourceVersions>(createResourceVersions())

function createSession(
  state: WorkspaceSessionState,
  input: WorkspaceSessionInput = {},
): WorkspaceSession {
  return {
    sessionId: nextSessionId(),
    workspaceId: input.workspaceId ?? '',
    projectRoot: input.projectRoot ?? '',
    state,
    resourceVersions: resourceVersions.value,
  }
}

const session = ref<WorkspaceSession>(createSession('idle'))
const cleanupRecords: WorkspaceCleanupRecord[] = []
const blobRecords: WorkspaceBlobRecord[] = []

function normalizeScopes(
  scopes: WorkspaceInvalidationScope | WorkspaceInvalidationScope[],
): WorkspaceInvalidationScope[] {
  const input = Array.isArray(scopes) ? scopes : [scopes]
  if (input.includes('all')) return [...WORKSPACE_INVALIDATION_SCOPES]
  return [...new Set(input)]
}

function revokeBlobRecord(index: number): void {
  const record = blobRecords[index]
  if (!record) return
  blobRecords.splice(index, 1)
  if (record.url.startsWith('blob:')) {
    URL.revokeObjectURL(record.url)
  }
}

function cleanupSession(sessionId: string): void {
  for (let i = cleanupRecords.length - 1; i >= 0; i -= 1) {
    const record = cleanupRecords[i]
    if (record?.sessionId !== sessionId) continue
    cleanupRecords.splice(i, 1)
    try {
      record.cleanup()
    } catch (error) {
      console.warn(`[workspace-lifecycle] cleanup failed (${record.label}):`, error)
    }
  }

  for (let i = blobRecords.length - 1; i >= 0; i -= 1) {
    if (blobRecords[i]?.sessionId === sessionId) {
      revokeBlobRecord(i)
    }
  }
}

function updateCurrentSession(patch: Partial<Omit<WorkspaceSession, 'sessionId' | 'resourceVersions'>>): void {
  session.value = {
    ...session.value,
    ...patch,
    resourceVersions: resourceVersions.value,
  }
}

export function useWorkspaceLifecycle() {
  const currentSessionId = computed(() => session.value.sessionId)

  function beginSession(input: WorkspaceSessionInput = {}): WorkspaceSession {
    const previousSessionId = session.value.sessionId
    if (session.value.state !== 'idle') {
      updateCurrentSession({ state: 'switching' })
      cleanupSession(previousSessionId)
    }

    session.value = createSession('validating', input)
    return session.value
  }

  function setSessionLoading(sessionId: string): void {
    if (!isCurrentSession(sessionId)) return
    updateCurrentSession({ state: 'loading' })
  }

  function activateSession(sessionId: string, input: WorkspaceSessionInput = {}): void {
    if (!isCurrentSession(sessionId)) return
    updateCurrentSession({
      workspaceId: input.workspaceId ?? session.value.workspaceId,
      projectRoot: input.projectRoot ?? session.value.projectRoot,
      state: 'active',
    })
  }

  function failSession(sessionId: string): void {
    if (!isCurrentSession(sessionId)) return
    updateCurrentSession({ state: 'failed' })
  }

  function closeSession(): void {
    const closingSessionId = session.value.sessionId
    if (session.value.state !== 'idle') {
      updateCurrentSession({ state: 'closing' })
    }
    cleanupSession(closingSessionId)
    session.value = createSession('idle')
  }

  function isCurrentSession(sessionId: string | undefined | null): boolean {
    return Boolean(sessionId) && session.value.sessionId === sessionId
  }

  async function runForSession<T>(
    sessionId: string,
    operation: () => T | Promise<T>,
  ): Promise<T | undefined> {
    if (!isCurrentSession(sessionId)) return undefined
    const result = await operation()
    if (!isCurrentSession(sessionId)) return undefined
    return result
  }

  function registerCleanup(
    cleanup: WorkspaceCleanup,
    options: WorkspaceCleanupOptions = {},
  ): () => void {
    const record: WorkspaceCleanupRecord = {
      id: ++cleanupSequence,
      sessionId: options.sessionId ?? session.value.sessionId,
      label: options.label ?? 'workspace cleanup',
      cleanup,
    }
    cleanupRecords.push(record)

    return () => {
      const index = cleanupRecords.findIndex(item => item.id === record.id)
      if (index !== -1) cleanupRecords.splice(index, 1)
    }
  }

  function registerBlobUrl(url: string, options: WorkspaceCleanupOptions = {}): void {
    if (!url) return
    blobRecords.push({
      url,
      sessionId: options.sessionId ?? session.value.sessionId,
    })
  }

  function revokeBlobUrl(url: string): void {
    for (let i = blobRecords.length - 1; i >= 0; i -= 1) {
      if (blobRecords[i]?.url === url) revokeBlobRecord(i)
    }
  }

  function invalidate(
    scopes: WorkspaceInvalidationScope | WorkspaceInvalidationScope[],
    options: WorkspaceInvalidationOptions = {},
  ): void {
    if (options.sessionId && !isCurrentSession(options.sessionId)) return

    const next = {
      ...resourceVersions.value,
    }
    for (const scope of normalizeScopes(scopes)) {
      next[scope] += 1
    }
    resourceVersions.value = next
    session.value = {
      ...session.value,
      resourceVersions: next,
    }
  }

  return {
    session,
    currentSessionId,
    resourceVersions,
    beginSession,
    setSessionLoading,
    activateSession,
    failSession,
    closeSession,
    isCurrentSession,
    runForSession,
    registerCleanup,
    registerBlobUrl,
    revokeBlobUrl,
    invalidate,
  }
}
