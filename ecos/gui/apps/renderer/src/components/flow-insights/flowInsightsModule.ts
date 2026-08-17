import type { Component } from 'vue'
import CongestionPanel from './CongestionPanel.vue'
import DbTrendsPanel from './DbTrendsPanel.vue'
import DrcPanel from './DrcPanel.vue'
import StaPanel from './StaPanel.vue'
import StepResourcesPanel from './StepResourcesPanel.vue'
import type {
  CongestionMapTileModel,
  DbTrendModel,
  DrcLayerTypeMatrix,
  StaOverviewModel,
  StepResourcesModel,
} from './flowInsightsData'

export interface FlowInsightsAvailabilityContext {
  stepResources: StepResourcesModel | null
  dbTrends: DbTrendModel | null
  congestionTiles: CongestionMapTileModel[]
  drc: DrcLayerTypeMatrix | null
  sta: StaOverviewModel | null
}

export interface FlowInsightsModuleAvailability {
  available: boolean
  hint: string
}

export interface FlowInsightsModuleDescriptor {
  id: string
  title: string
  icon: string
  component: Component
  availability: (
    context: FlowInsightsAvailabilityContext,
  ) => FlowInsightsModuleAvailability
}

export const FLOW_INSIGHT_MODULES: FlowInsightsModuleDescriptor[] = [
  {
    id: 'resources',
    title: 'Step Trends',
    icon: 'ri-timer-flash-line',
    component: StepResourcesPanel,
    availability: (context) => ({
      available: context.stepResources !== null,
      hint: context.stepResources ? 'Runtime / memory by step' : 'Waiting for flow data',
    }),
  },
  {
    id: 'db-trends',
    title: 'DB Trends',
    icon: 'ri-bar-chart-grouped-line',
    component: DbTrendsPanel,
    availability: (context) => ({
      available: (context.dbTrends?.rows.length ?? 0) > 0,
      hint: context.dbTrends?.rows.length
        ? 'Metric × step matrix with deltas'
        : 'Waiting for step db statistics',
    }),
  },
  {
    id: 'congestion',
    title: 'Congestion',
    icon: 'ri-fire-line',
    component: CongestionPanel,
    availability: (context) => ({
      available: context.congestionTiles.length > 0,
      hint: context.congestionTiles.length
        ? 'EGR / RUDY / density maps'
        : 'Waiting for place / CTS maps',
    }),
  },
  {
    id: 'drc',
    title: 'DRC',
    icon: 'ri-shield-check-line',
    component: DrcPanel,
    availability: (context) => ({
      available: context.drc !== null,
      hint: context.drc ? 'Violations by layer / type' : 'Waiting for drc step',
    }),
  },
  {
    id: 'timing',
    title: 'Timing',
    icon: 'ri-time-line',
    component: StaPanel,
    availability: (context) => ({
      available: context.sta !== null,
      hint: context.sta ? 'Corner WNS / TNS overview' : 'Waiting for sta step',
    }),
  },
]

export function resolveFlowInsightModules(
  context: FlowInsightsAvailabilityContext,
): Array<FlowInsightsModuleDescriptor & FlowInsightsModuleAvailability> {
  return FLOW_INSIGHT_MODULES.map((module) => ({
    ...module,
    ...module.availability(context),
  }))
}
