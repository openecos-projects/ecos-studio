// Info 消息中的单个数据项
export interface InfoItem {
  label: string
  content: any
  format: 'json' | 'csv' | 'text'
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

export interface Project {
  id: string
  name: string
  path: string
  lastOpened: Date
  /** 路径是否存在（加载时异步检测，undefined 表示尚未检测） */
  pathExists?: boolean
}

// New Project Wizard Types
export interface WorkspaceParameters {
  // 基本信息
  design: string;           // 项目/设计名称
  description?: string;     // 项目描述
  // 设计参数
  top_module: string;       // 顶层模块名
  clock: string;            // 时钟信号名
  // 工艺参数
  frequency_max: number;    // 目标频率 (MHz)
  core_utilization: number; // 核心利用率 (0-1)
  target_density: number;   // 目标密度 (0-1)
  max_fanout: number;       // 最大扇出
}

export interface WorkspaceConfig {
  directory: string;
  pdk: string;
  pdk_root: string;
  parameters: Partial<WorkspaceParameters> & Record<string, unknown>;
  origin_def: string;
  origin_verilog: string;
  rtl_list: string[];
}

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
