import { randomUUID } from 'node:crypto'

export interface WorkspaceSessionRecord {
  directory: string
  eccWorkspaceId: string | null
  workspaceHandle: string
}

export class WorkspaceSessionNotFoundError extends Error {
  constructor(workspaceHandle: string) {
    super(`Workspace session not found: ${workspaceHandle}`)
    this.name = 'WorkspaceSessionNotFoundError'
  }
}

export interface WorkspaceSessionRegistryOptions {
  idProvider?: () => string
}

export class WorkspaceSessionRegistry {
  private activeHandle: string | null = null
  private readonly idProvider: () => string
  private readonly sessions = new Map<string, WorkspaceSessionRecord>()

  constructor(options: WorkspaceSessionRegistryOptions = {}) {
    this.idProvider = options.idProvider ?? (() => `workspace-${randomUUID()}`)
  }

  get active(): WorkspaceSessionRecord | null {
    if (!this.activeHandle) {
      return null
    }
    const session = this.sessions.get(this.activeHandle)
    return session ? { ...session } : null
  }

  activate(directory: string, eccWorkspaceId: string): WorkspaceSessionRecord {
    const session = {
      directory,
      eccWorkspaceId,
      workspaceHandle: this.idProvider(),
    }
    this.sessions.set(session.workspaceHandle, session)
    this.activeHandle = session.workspaceHandle
    return { ...session }
  }

  clearEccWorkspaceIds(): void {
    for (const [workspaceHandle, session] of this.sessions) {
      this.sessions.set(workspaceHandle, {
        ...session,
        eccWorkspaceId: null,
      })
    }
  }

  close(workspaceHandle: string): void {
    if (!this.sessions.delete(workspaceHandle) || this.activeHandle !== workspaceHandle) {
      return
    }
    this.activeHandle = Array.from(this.sessions.keys()).at(-1) ?? null
  }

  rebind(workspaceHandle: string, eccWorkspaceId: string): WorkspaceSessionRecord {
    const session = this.require(workspaceHandle)
    const rebound = {
      ...session,
      eccWorkspaceId,
    }
    this.sessions.set(workspaceHandle, rebound)
    return { ...rebound }
  }

  hasOtherEccWorkspaceReference(
    workspaceHandle: string,
    eccWorkspaceId: string,
  ): boolean {
    for (const [candidateHandle, session] of this.sessions) {
      if (
        candidateHandle !== workspaceHandle &&
        session.eccWorkspaceId === eccWorkspaceId
      ) {
        return true
      }
    }
    return false
  }

  require(workspaceHandle: string): WorkspaceSessionRecord {
    const session = this.sessions.get(workspaceHandle)
    if (!session) {
      throw new WorkspaceSessionNotFoundError(workspaceHandle)
    }
    return { ...session }
  }
}
