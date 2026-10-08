/**
 * Minimal structural typing for the window.ecosDesktop preload bridge as
 * consumed by the e2e harness. Only the methods the harness drives are
 * declared; payloads cross as plain JSON exactly as the renderer sends them.
 */
export interface E2EBridge {
  app: {
    getVersions(): Promise<Record<string, string | undefined>>
  }
  cliInstaller: {
    getStatus(): Promise<{ status: string; error?: string | null }>
  }
  pdkInventory: {
    import(request: {
      root: string
      familyId: string
      displayName: string
    }): Promise<{ id?: string; readiness?: string }>
  }
  projectManifest: {
    mutate(request: unknown): Promise<unknown>
  }
  projectManagement: {
    readManifest(projectRoot: string): Promise<{ project_id?: string } | null>
  }
  productCommands: {
    execute(request: { command: string; payload: unknown }): Promise<unknown>
  }
  workspace: {
    registerProjectRoot(path: string): Promise<string>
  }
  backendWorkspace: {
    refreshOverview(): Promise<unknown>
  }
  ecc: {
    runtime: {
      waitForOperation(request: {
        workspaceHandle: string
        operationId: string
      }): Promise<unknown>
      operationLog(request: {
        workspaceHandle: string
        operationId: string
      }): Promise<{ content: string }>
    }
  }
}

declare global {
  interface Window {
    ecosDesktop: E2EBridge
  }
}
