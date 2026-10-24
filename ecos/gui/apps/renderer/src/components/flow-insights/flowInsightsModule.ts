import type { Component } from 'vue'
import DbTrendsPanel from './DbTrendsPanel.vue'
import DrcPanel from './DrcPanel.vue'
import PowerSummaryPanel from './PowerSummaryPanel.vue'
import StaPanel from './StaPanel.vue'
import StepDetailsPanel from './StepDetailsPanel.vue'
import StepResourcesPanel from './StepResourcesPanel.vue'
import type {
  DbTrendModel,
  DrcLayerTypeMatrix,
  StaOverviewModel,
  StepResourcesModel,
} from './flowInsightsData'
import type { PowerSummaryModel } from './powerSummary'
import type { StepDetailsModel } from './stepDetails'

export interface FlowInsightsAvailabilityContext {
  stepResources: StepResourcesModel | null
  dbTrends: DbTrendModel | null
  drc: DrcLayerTypeMatrix | null
  sta: StaOverviewModel | null
  powerSummary: PowerSummaryModel | null
  lvsSummary: StepDetailsModel | null
  antennaSummary: StepDetailsModel | null
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
    id: 'power',
    title: 'Power',
    icon: 'ri-flashlight-line',
    component: PowerSummaryPanel,
    availability: () => ({
      available: true,
      hint: 'Power summary from powerAnalysis',
    }),
  },
  {
    id: 'lvs',
    title: 'LVS',
    icon: 'ri-git-compare-line',
    component: StepDetailsPanel,
    availability: () => ({
      available: true,
      hint: 'LVS entity and connectivity results',
    }),
  },
  {
    id: 'antenna',
    title: 'Antenna',
    icon: 'ri-radar-line',
    component: StepDetailsPanel,
    availability: () => ({
      available: true,
      hint: 'Antenna check coverage and violations',
    }),
  },
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
