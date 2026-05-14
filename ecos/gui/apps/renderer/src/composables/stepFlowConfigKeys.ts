import { StepEnum } from '@/api/type'

/**
 * flow_config.json 内 `ConfigPath` 的字段名与流程步骤的对应关系。
 * 模板示例见项目 templates 下 `.../config/flow_config.json`。
 */
export function getConfigPathKeyForStep(step: StepEnum): string | undefined {
  return STEP_TO_FLOW_CONFIG_PATH_KEY[step]
}

const STEP_TO_FLOW_CONFIG_PATH_KEY: Partial<Record<StepEnum, string>> = {
  [StepEnum.SYNTHESIS]: 'idb_path',
  [StepEnum.NETLIST_OPT]: 'idb_path',
  [StepEnum.FLOORPLAN]: 'ifp_path',
  [StepEnum.PLACEMENT]: 'ipl_path',
  [StepEnum.LEGALIZATION]: 'ipl_path',
  [StepEnum.CTS]: 'icts_path',
  [StepEnum.PNP]: 'ipnp_path',
  [StepEnum.TIMING_OPT]: 'ito_path',
  [StepEnum.TIMING_OPT_DRV]: 'ito_path',
  [StepEnum.TIMING_OPT_HOLD]: 'ito_path',
  [StepEnum.TIMING_OPT_SETUP]: 'ito_path',
  [StepEnum.ROUTING]: 'irt_path',
  [StepEnum.FILLER]: 'irt_path',
  [StepEnum.DRC]: 'idrc_path',
}
