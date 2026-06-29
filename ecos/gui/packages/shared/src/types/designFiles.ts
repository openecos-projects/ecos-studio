export interface WorkspaceDesignFileEntry {
  /** Path as written in the workspace filelist. */
  filelistEntry: string
  basename: string
  resolvedPath: string
  exists: boolean
  /** True when the RTL file lives under workspace/origin/. */
  managedInWorkspace: boolean
}

export interface WorkspaceDesignFileSkip {
  path: string
  reason: string
}

export interface WorkspaceDesignFileAddResult {
  added: WorkspaceDesignFileEntry[]
  skipped: WorkspaceDesignFileSkip[]
}
