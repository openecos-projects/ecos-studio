export type DesktopCliCommandName =
  | 'help'
  | 'clear'
  | 'load_workspace'
  | 'create_workspace'
  | 'run_step'
  | 'rtl2gds'
  | 'get_info'
  | 'home_page'
  | 'refresh_config'
  | 'sync_config'

export type DesktopCliCommandSource = 'button' | 'menu' | 'terminal' | 'test'

export type DesktopCliCommandResponse =
  | 'success'
  | 'failed'
  | 'error'
  | 'warning'
  | 'cancelled'

export type DesktopCliCommandEventType =
  | 'queued'
  | 'started'
  | 'stdout'
  | 'stderr'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface DesktopCliCommandRequest {
  cmd: DesktopCliCommandName
  data: Record<string, unknown>
  source: DesktopCliCommandSource
}

export interface DesktopCliCommandResult {
  ok: boolean
  cmd: DesktopCliCommandName
  response: DesktopCliCommandResponse
  data: Record<string, unknown>
  message: string[]
}

export interface DesktopCliCommandEvent {
  jobId: string
  cmd: DesktopCliCommandName
  type: DesktopCliCommandEventType
  data?: Record<string, unknown>
  workspaceId?: string
  directory?: string
  stream?: 'stdout' | 'stderr' | 'system'
  text?: string
  result?: DesktopCliCommandResult
}
