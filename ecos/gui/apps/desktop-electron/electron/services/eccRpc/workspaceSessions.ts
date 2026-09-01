import { randomUUID } from 'node:crypto'

export interface WorkspaceSessionRecord {
  directory: string
  eccWorkspaceId: string | null
  workspaceHandle: string
  workspaceRevision: number
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

  get size(): number {
    return this.sessions.size
  }

  activate(
    directory: string,
    eccWorkspaceId: string | null,
    workspaceRevision = 0,
  ): WorkspaceSessionRecord {
    const session = {
      directory,
      eccWorkspaceId,
      workspaceHandle: this.idProvider(),
      workspaceRevision,
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
        workspaceRevision: 0,
      })
    }
  }

  close(workspaceHandle: string): void {
    if (!this.sessions.delete(workspaceHandle) || this.activeHandle !== workspaceHandle) {
      return
    }
    this.activeHandle = Array.from(this.sessions.keys()).at(-1) ?? null
  }

  rebind(
    workspaceHandle: string,
    eccWorkspaceId: string,
    workspaceRevision = 0,
  ): WorkspaceSessionRecord {
    const session = this.require(workspaceHandle)
    const rebound = {
      ...session,
      eccWorkspaceId,
      workspaceRevision,
    }
    this.sessions.set(workspaceHandle, rebound)
    return { ...rebound }
  }

  updateRevision(workspaceHandle: string, workspaceRevision: number): void {
    const session = this.require(workspaceHandle)
    this.sessions.set(workspaceHandle, { ...session, workspaceRevision })
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

  findByEccWorkspaceId(eccWorkspaceId: string): WorkspaceSessionRecord | null {
    for (const session of this.sessions.values()) {
      if (session.eccWorkspaceId === eccWorkspaceId) {
        return { ...session }
      }
    }
    return null
  }

  findByDirectory(directory: string): WorkspaceSessionRecord | null {
    for (const session of this.sessions.values()) {
      if (session.directory === directory) {
        return { ...session }
      }
    }
    return null
  }

  require(workspaceHandle: string): WorkspaceSessionRecord {
    const session = this.sessions.get(workspaceHandle)
    if (!session) {
      throw new WorkspaceSessionNotFoundError(workspaceHandle)
    }
    return { ...session }
  }
}
