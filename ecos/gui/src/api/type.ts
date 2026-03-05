export enum CMDEnum {
  create_workspace = "create_workspace",
  load_workspace = "load_workspace",
  delete_workspace = "delete_workspace",
  rtl2gds = "rtl2gds",
  run_step = "run_step",
  get_info = "get_info",
  home_page = "home_page"
}

// get_info command 的 id 枚举
export enum InfoEnum {
  views = "views",
  layout = "layout",
  metrics = "metrics",
  subflow = "subflow",
  analysis = "analysis",
  maps = "maps",
  checklist = "checklist",
  sta = "sta"
}

export enum StepEnum {
  RTL2GDS = "RTL2GDS",
  INIT = "Init",
  SOC = "SOC",
  FUNC_SIM = "Functional simulation",
  SYNTHESIS = "Synthesis",
  FLOORPLAN = "Floorplan",
  NETLIST_OPT = "fixFanout",
  PLACEMENT = "place",
  CTS = "CTS",
  PNP = "PNP",
  TIMING_OPT = "Timing optimization",
  TIMING_OPT_DRV = "optDrv",
  TIMING_OPT_HOLD = "optHold",
  TIMING_OPT_SETUP = "optSetup",
  LEGALIZATION = "legalization",
  ROUTING = "route",
  FILLER = "filler",
  GDS = "GDS",
  SIGNOFF = "Signoff",
  STA = "sta",
  DRC = "drc",
  RCX = "RCX",
  ABSTRACT_LEF = "Abstract lef",
  MERGE = "GDS merge"
}

/** 步骤元数据配置 */
export interface StepMetadata {
  /** 显示标签 */
  label: string
  /** 图标类名 (remix icon) */
  icon: string
  /** 路由路径 (用于 URL) */
  path: string
  /** 是否在侧边栏显示 */
  showInSidebar: boolean
  /** 分组: setup=设置页面, run=运行步骤 */
  group: 'setup' | 'run'
}

/** 所有步骤的元数据映射 */
export const STEP_METADATA: Record<string, StepMetadata> = {
  // 设置页面
  'home': { label: 'Home', icon: 'ri-home-4-line', path: 'home', showInSidebar: true, group: 'setup' },
  'configure': { label: 'Config', icon: 'ri-settings-3-line', path: 'configure', showInSidebar: true, group: 'setup' },

  // 运行步骤 (key 为 flow.json 中的 step.name 小写)
  [StepEnum.SYNTHESIS.toLowerCase()]: { label: 'Synthesis', icon: 'ri-node-tree', path: StepEnum.SYNTHESIS, showInSidebar: true, group: 'run' },
  [StepEnum.FLOORPLAN.toLowerCase()]: { label: 'Floorplan', icon: 'ri-layout-4-line', path: StepEnum.FLOORPLAN, showInSidebar: true, group: 'run' },
  [StepEnum.NETLIST_OPT.toLowerCase()]: { label: 'FixFanout', icon: 'ri-share-line', path: StepEnum.NETLIST_OPT, showInSidebar: false, group: 'run' },
  [StepEnum.PLACEMENT.toLowerCase()]: { label: 'Place', icon: 'ri-focus-2-line', path: StepEnum.PLACEMENT, showInSidebar: true, group: 'run' },
  [StepEnum.CTS.toLowerCase()]: { label: 'CTS', icon: 'ri-git-merge-line', path: StepEnum.CTS, showInSidebar: true, group: 'run' },
  [StepEnum.TIMING_OPT_DRV.toLowerCase()]: { label: 'OptDrv', icon: 'ri-speed-line', path: StepEnum.TIMING_OPT_DRV, showInSidebar: false, group: 'run' },
  [StepEnum.TIMING_OPT_HOLD.toLowerCase()]: { label: 'OptHold', icon: 'ri-time-line', path: StepEnum.TIMING_OPT_HOLD, showInSidebar: false, group: 'run' },
  [StepEnum.TIMING_OPT_SETUP.toLowerCase()]: { label: 'OptSetup', icon: 'ri-timer-line', path: StepEnum.TIMING_OPT_SETUP, showInSidebar: false, group: 'run' },
  [StepEnum.LEGALIZATION.toLowerCase()]: { label: 'Legalization', icon: 'ri-check-double-line', path: StepEnum.LEGALIZATION, showInSidebar: false, group: 'run' },
  [StepEnum.ROUTING.toLowerCase()]: { label: 'Route', icon: 'ri-route-line', path: StepEnum.ROUTING, showInSidebar: true, group: 'run' },
  [StepEnum.FILLER.toLowerCase()]: { label: 'Filler', icon: 'ri-grid-fill', path: StepEnum.FILLER, showInSidebar: true, group: 'run' },
  [StepEnum.DRC.toLowerCase()]: { label: 'DRC', icon: 'ri-checkbox-circle-line', path: StepEnum.DRC, showInSidebar: true, group: 'run' },
  [StepEnum.STA.toLowerCase()]: { label: 'STA', icon: 'ri-pulse-line', path: StepEnum.STA, showInSidebar: true, group: 'run' },
  [StepEnum.GDS.toLowerCase()]: { label: 'GDS', icon: 'ri-file-download-line', path: StepEnum.GDS, showInSidebar: true, group: 'run' },
  [StepEnum.SIGNOFF.toLowerCase()]: { label: 'Signoff', icon: 'ri-verified-badge-line', path: StepEnum.SIGNOFF, showInSidebar: true, group: 'run' },
  [StepEnum.RCX.toLowerCase()]: { label: 'RCX', icon: 'ri-flashlight-line', path: StepEnum.RCX, showInSidebar: false, group: 'run' },
  [StepEnum.ABSTRACT_LEF.toLowerCase()]: { label: 'AbsLef', icon: 'ri-file-text-line', path: StepEnum.ABSTRACT_LEF, showInSidebar: false, group: 'run' },
  [StepEnum.MERGE.toLowerCase()]: { label: 'Merge', icon: 'ri-merge-cells-horizontal', path: StepEnum.MERGE, showInSidebar: false, group: 'run' },
}

/**
 * 根据步骤名称获取元数据
 * @param stepName flow.json 中的 step.name
 */
export function getStepMetadata(stepName: string): StepMetadata | undefined {
  return STEP_METADATA[stepName.toLowerCase()]
}

/**
 * 获取所有可在侧边栏显示的运行步骤
 */
export function getSidebarSteps(): StepMetadata[] {
  return Object.values(STEP_METADATA).filter(m => m.showInSidebar && m.group === 'run')
}

export enum ResponseEnum {
  success = "success",
  failed = "failed",
  error = "error",
  warning = "warning"
}

export enum StateEnum {
  Invalid = "Invalid",
  Unstart = "Unstart",
  Success = "Success",
  Ongoing = "Ongoing",
  Pending = "Pending",
  Imcomplete = "Imcomplete",
  // Ignored = "Ignored",
}

export enum CheckState {
  Unstart = "Unstart",
  Success = "Success",
  Failed = "Failed",
  Warning = "Warning",
}

export interface RequestData<T> {
  cmd: CMDEnum;
  data: T;
}

export interface ResponseData<T> {
  cmd: CMDEnum;
  response: ResponseEnum;
  data: T;
  message: string[];
}

