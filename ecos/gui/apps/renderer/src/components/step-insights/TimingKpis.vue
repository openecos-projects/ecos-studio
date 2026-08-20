<template>
  <div class="timing-kpis" :class="{ 'is-compact': compact }">
    <div class="timing-kpi" :class="slackTone(overview.worstSetup?.wns)">
      <span>Worst setup WNS</span>
      <strong>{{ formatSlack(overview.worstSetup?.wns) }}</strong>
      <small v-if="attributesCorner">{{ overview.worstSetup?.corner ?? '--' }}</small>
    </div>
    <div class="timing-kpi" :class="slackTone(overview.worstHold?.wns)">
      <span>Worst hold WNS</span>
      <strong>{{ formatSlack(overview.worstHold?.wns) }}</strong>
      <small v-if="attributesCorner">{{ overview.worstHold?.corner ?? '--' }}</small>
    </div>
    <div class="timing-kpi" :class="thirdTone">
      <span>{{ thirdLabel }}</span>
      <strong>{{ thirdValue }}</strong>
      <small>{{ thirdHint }}</small>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { StaOverviewModel } from '../flow-insights/flowInsightsData'
import { formatFrequency, formatSlack, slackTone } from './timingFormat'

const props = defineProps<{
  overview: StaOverviewModel
  compact?: boolean
}>()

const hasFrequency = computed(() => props.overview.frequencyMhz !== null)
/** Corner attribution is redundant when the summary covers a single corner. */
const attributesCorner = computed(() => props.overview.corners.length > 1)

const thirdLabel = computed(() => (hasFrequency.value ? 'Frequency' : 'Violating paths'))

const thirdValue = computed(() =>
  hasFrequency.value
    ? formatFrequency(props.overview.frequencyMhz)
    : String(props.overview.setupViolationCount + props.overview.holdViolationCount),
)

const thirdHint = computed(() => {
  if (hasFrequency.value) {
    const met = props.overview.allCornersMet
    if (met === null || met === undefined) return ''
    return met ? 'all corners met' : 'violations'
  }
  return 'setup + hold NVP'
})

const thirdTone = computed(() => {
  if (hasFrequency.value) {
    const met = props.overview.allCornersMet
    if (met === null || met === undefined) return ''
    return met ? 'is-good' : 'is-bad'
  }
  const violations =
    props.overview.setupViolationCount + props.overview.holdViolationCount
  return violations > 0 ? 'is-bad' : 'is-good'
})
</script>

<style scoped>
.timing-kpis {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.timing-kpi {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 14px;
}

.timing-kpi span {
  color: var(--text-secondary);
  font-size: 10px;
}

.timing-kpi strong {
  color: var(--text-primary);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.timing-kpi small {
  color: var(--text-secondary);
  font-size: 9px;
}

.timing-kpi.is-good strong {
  color: var(--success-color);
}

.timing-kpi.is-bad strong {
  color: var(--danger-color);
}

.timing-kpis.is-compact {
  gap: 4px;
}

.timing-kpis.is-compact .timing-kpi {
  border-radius: 6px;
  flex: 1 1 0;
  gap: 1px;
  min-width: 0;
  padding: 4px 8px;
}

.timing-kpis.is-compact .timing-kpi span {
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timing-kpis.is-compact .timing-kpi strong {
  font-size: 12px;
}

.timing-kpis.is-compact .timing-kpi small {
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
