export const desktopMenuEventIds = {
  newWindow: 'new_window',
  newProject: 'new_project',
  openProject: 'open_project',
  save: 'save',
  saveAs: 'save_as',
  toggleSidebar: 'toggle_sidebar',
  toggleInspector: 'toggle_inspector',
  zoomIn: 'zoom_in',
  zoomOut: 'zoom_out',
  zoomReset: 'zoom_reset',
  documentation: 'documentation',
  releaseNotes: 'release_notes',
  reportIssue: 'report_issue',
  about: 'about',
  manageDesignFiles: 'manage_design_files',
  reconfigureWorkspace: 'reconfigure_workspace',
  exportSignoffPackage: 'export_signoff_package',
  exportDesignSummary: 'export_design_summary',
  exportDesignMetrics: 'export_design_summary',
} as const

export type DesktopMenuEventId =
  (typeof desktopMenuEventIds)[keyof typeof desktopMenuEventIds]

export const appMenuActionIds = {
  documentation: desktopMenuEventIds.documentation,
  about: desktopMenuEventIds.about,
  newWindow: desktopMenuEventIds.newWindow,
  newProject: desktopMenuEventIds.newProject,
  openProject: desktopMenuEventIds.openProject,
  zoomIn: desktopMenuEventIds.zoomIn,
  zoomOut: desktopMenuEventIds.zoomOut,
  zoomReset: desktopMenuEventIds.zoomReset,
  manageDesignFiles: desktopMenuEventIds.manageDesignFiles,
  reconfigureWorkspace: desktopMenuEventIds.reconfigureWorkspace,
  exportSignoffPackage: desktopMenuEventIds.exportSignoffPackage,
  exportDesignSummary: desktopMenuEventIds.exportDesignSummary,
  exportDesignMetrics: desktopMenuEventIds.exportDesignSummary,
} as const

export type AppMenuAction = (typeof appMenuActionIds)[keyof typeof appMenuActionIds]

export type DesktopEventUnsubscribe = () => void

export type DesktopProjectFileChangeEventType = 'change' | 'rename' | 'error'

export interface DesktopProjectFileChangedEvent {
  subscriptionId: string
  path: string
  eventType: DesktopProjectFileChangeEventType
}

export type DesktopProjectLogTailEventType =
  | 'snapshot'
  | 'append'
  | 'reset'
  | 'waiting'
  | 'error'
  | 'closed'

export interface DesktopProjectLogTailEvent {
  subscriptionId: string
  path: string
  eventType: DesktopProjectLogTailEventType
  content?: string
  fromOffsetBytes?: number
  nextOffsetBytes?: number
  sizeBytes?: number
  reset?: boolean
  truncated?: boolean
  reason?: string
}
