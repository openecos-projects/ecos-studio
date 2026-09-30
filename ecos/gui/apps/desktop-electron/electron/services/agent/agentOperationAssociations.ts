/**
 * Records which Agent-driven command produced which ECC Runtime Operation, so
 * main process can correlate a chat session with its execution evidence.
 *
 * Terminal state is deliberately not stored here: it already lives in
 * RuntimeOperationTracker (bounded to the latest operations) and is queryable
 * through the ECC runtime service operation APIs.
 *
 * Stop semantics: agent interrupt today only interrupts the chat turn; it does
 * not cancel a linked ECC Operation. Upgrading Stop to also cancel the active
 * associated operation is the planned next step — this table is the lookup
 * that step will use.
 *
 * Session identity: host-channel requests (workspace.run / candidate.rerun /
 * candidate.resume) carry no per-session identity, so those associations are
 * keyed by providerId. Renderer-registered associations use the tracked
 * session key `${providerId}:${sessionId}`.
 */
export interface AgentOperationAssociation {
  command: string
  operationId: string
  recordedAt: number
  workspaceHandle?: string
}

const MAX_ASSOCIATIONS_PER_SESSION = 64

const associationsBySession = new Map<string, AgentOperationAssociation[]>()

export function recordAgentOperationAssociation(
  sessionKey: string,
  association: Omit<AgentOperationAssociation, 'recordedAt'>,
): void {
  const associations = associationsBySession.get(sessionKey) ?? []
  associations.push({ ...association, recordedAt: Date.now() })
  while (associations.length > MAX_ASSOCIATIONS_PER_SESSION) associations.shift()
  associationsBySession.set(sessionKey, associations)
}

export function getAgentOperationAssociation(
  sessionKey: string,
  operationId: string,
): AgentOperationAssociation | null {
  const associations = associationsBySession.get(sessionKey)
  return (
    associations?.find((association) => association.operationId === operationId) ?? null
  )
}

export function agentOperationAssociationsForSession(
  sessionKey: string,
): AgentOperationAssociation[] {
  return [...(associationsBySession.get(sessionKey) ?? [])]
}

export function resetAgentOperationAssociations(): void {
  associationsBySession.clear()
}
