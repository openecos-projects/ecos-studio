import type {
  WorkspaceConfig as SharedWorkspaceConfig,
  WorkspaceParameters as SharedWorkspaceParameters,
  WorkspaceStatus as SharedWorkspaceStatus,
  WorkspaceSummary,
} from '@ecos-studio/shared'

// Info 消息中的单个数据项
export interface InfoItem {
  label: string
  content: any
  format: 'json' | 'csv' | 'text' | 'html'
}

// Info 消息的数据结构
export interface InfoData {
  title: string
  step: string
  items: InfoItem[]
}

// Map 信息数据结构
export interface MapInfo {
  path: string
  info: string[]
}

// Map 消息的数据结构（用于在 chat 中展示热力图）
export interface MapData {
  title: string
  step: string
  imageUrl: string
  localPath: string
  info: string[]
  category?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  type?: 'text' | 'image' | 'info' | 'map'
  status?: 'loading' | 'done' | 'error'
  image?: {
    url: string
    label?: string
    dimensions?: string
    thumbnailId?: number
    description?: string
  }
  infoData?: InfoData
  mapData?: MapData
}

export interface Thumbnail {
  id: number
  label: string
  description?: string
  thumbnailUrl?: string
  imageUrl?: string
  size?: string
  dimensions?: string
  format?: string
}

export type ProjectStatus = SharedWorkspaceStatus

export interface Project extends Omit<WorkspaceSummary, 'lastOpened'> {
  lastOpened: Date
}

// New Project Wizard Types
export type WorkspaceParameters = SharedWorkspaceParameters

export type WorkspaceConfig = SharedWorkspaceConfig

// 已导入的 PDK 信息（持久化存储）
export interface ImportedPdk {
  id: string
  name: string           // 显示名称，如 "ICS55 PDK"
  path: string           // PDK 根目录绝对路径
  description: string    // 描述
  techNode: string       // 工艺节点，如 "55nm"
  pdkId: string          // 后端 pdk 标识符，如 "ics55"
  importedAt: string     // ISO 日期字符串
  detectedFiles?: {      // 扫描到的目录结构摘要
    directories: string[]
    files: string[]
  }
}

export interface DesignFile {
  id: string
  name: string
  path: string
  type: 'verilog' | 'vhdl' | 'systemverilog' | 'constraint' | 'other'
  size?: number
}

export interface WizardStep {
  id: number
  title: string
  description: string
  isCompleted: boolean
  isActive: boolean
}
