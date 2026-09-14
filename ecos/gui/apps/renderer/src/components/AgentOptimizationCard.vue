<template>
  <section
    class="optimization-card"
    :data-state="liveState ? 'running' : 'done'"
    aria-label="Optimization episode"
  >
    <button
      type="button"
      class="optimization-card__toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <i
        v-if="liveState"
        class="ri-loader-4-line optimization-card__spinner"
        aria-hidden="true"
      ></i>
      <i v-else class="ri-sparkling-2-line" aria-hidden="true"></i>
      <span class="optimization-card__title">
        Optimization · {{ optimization.active_primary_metric || 'episode' }}
      </span>
      <span
        v-if="optimization.recovery_stage && optimization.recovery_stage !== 'original'"
        class="optimization-card__badge optimization-card__badge--recovery"
      >
        recovering {{ optimization.recovery_stage }}
      </span>
      <span
        v-for="(metric, index) in latestCounts"
        :key="index"
        class="optimization-card__metric"
      >
        {{ metric.label }} {{ metric.value }}
      </span>
      <i
        class="ri-arrow-down-s-line optimization-card__chevron"
        :class="{ 'is-open': expanded }"
        aria-hidden="true"
      ></i>
    </button>

    <div v-show="expanded" class="optimization-card__body">
      <div v-for="(entry, index) in rows" :key="index" class="optimization-card__row">
        <span class="optimization-card__turn">{{ entry.label }}</span>
        <span
          v-if="entry.action"
          class="optimization-card__action"
          :title="entry.direction ?? ''"
        >
          <i class="ri-settings-3-line" aria-hidden="true"></i>
          {{ entry.action.knob_id }}
          <i :class="directionIcon(entry.direction)" aria-hidden="true"></i>
          <template v-if="entry.requested"> → {{ entry.requested.value }}</template>
        </span>
        <span
          v-if="entry.proposalDecision"
          class="optimization-card__badge"
          :class="
            entry.proposalDecision === 'reject'
              ? 'optimization-card__badge--muted'
              : 'optimization-card__badge--info'
          "
        >
          {{ entry.proposalDecision
          }}{{ entry.proposalReason ? ` · ${entry.proposalReason}` : '' }}
        </span>
        <span
          v-if="entry.incumbentDecision"
          class="optimization-card__badge"
          :class="
            entry.promoted
              ? 'optimization-card__badge--good'
              : 'optimization-card__badge--muted'
          "
        >
          {{ entry.incumbentDecision }}
        </span>
        <span
          v-if="entry.recoveryTransition"
          class="optimization-card__badge optimization-card__badge--recovery"
        >
          {{ entry.recoveryTransition }}
        </span>
        <span v-if="entry.counts" class="optimization-card__counts">
          DRC {{ entry.counts.drc_count }} · setup
          {{ entry.counts.sta_setup_violation_count }} · hold
          {{ entry.counts.sta_hold_violation_count }}
        </span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DesktopAgentOptimizationPayload } from '@ecos-studio/shared'

const props = defineProps<{
  optimization: DesktopAgentOptimizationPayload
  timeline: DesktopAgentOptimizationPayload[]
}>()

const expanded = ref(true)

/** Mirrors backend PROMOTING_DECISIONS (rules.py). */
const PROMOTING_DECISIONS = new Set([
  'initialized',
  'candidate_better',
  'recovery_progress',
  'parity_objective_improved',
])

const LIVE_STATES = new Set(['created', 'planning', 'awaiting_execution', 'executing'])

const liveState = computed(() => {
  const state = props.optimization.state
  return typeof state === 'string' && LIVE_STATES.has(state)
})

const latestCounts = computed(() => {
  const counts = props.optimization.violation_counts
  if (!counts) return []
  return [
    { label: 'DRC', value: counts.drc_count },
    { label: 'Setup', value: counts.sta_setup_violation_count },
    { label: 'Hold', value: counts.sta_hold_violation_count },
  ]
})

interface OptimizationRow {
  label: string
  action?: { knob_id: string } | null
  direction?: string | null
  requested?: { knob_id: string; value: boolean | number } | null
  proposalDecision?: string | null
  proposalReason?: string | null
  incumbentDecision?: string | null
  promoted?: boolean
  recoveryTransition?: string | null
  counts?: DesktopAgentOptimizationPayload['violation_counts']
}

const rows = computed<OptimizationRow[]>(() =>
  props.timeline.map((entry) => {
    const isAuthorization = entry.schema_version === 'ecos.optimization_authorization.v2'
    const incumbentDecision = entry.incumbent_decision ?? null
    return {
      label: isAuthorization
        ? 'Authorized'
        : typeof entry.turn === 'number'
          ? `Turn ${entry.turn}`
          : 'Episode',
      action: entry.action ?? null,
      direction: entry.action?.direction ?? null,
      requested: entry.requested ?? null,
      proposalDecision: entry.proposal_decision ?? null,
      proposalReason: entry.proposal_reason ?? null,
      incumbentDecision,
      promoted: incumbentDecision ? PROMOTING_DECISIONS.has(incumbentDecision) : false,
      recoveryTransition: entry.recovery_transition ?? null,
      counts: entry.violation_counts,
    }
  }),
)

function directionIcon(direction: string | null | undefined): string {
  switch (direction) {
    case 'increase':
      return 'ri-arrow-up-line'
    case 'decrease':
      return 'ri-arrow-down-line'
    case 'enable':
      return 'ri-toggle-left-line'
    case 'disable':
      return 'ri-toggle-right-line'
    default:
      return 'ri-arrow-right-line'
  }
}
</script>

<style scoped>
.optimization-card {
  width: 100%;
  min-width: 0;
  max-width: min(94%, 68rem);
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 0.625rem;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.optimization-card__toggle {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
  font-size: 0.75rem;
}

.optimization-card__toggle:hover {
  background: color-mix(in srgb, var(--bg-primary) 54%, transparent);
}

.optimization-card__spinner {
  animation: optimization-card-spin 1s linear infinite;
  color: var(--accent-color);
}

@keyframes optimization-card-spin {
  to {
    transform: rotate(360deg);
  }
}

.optimization-card__title {
  font-weight: 600;
  white-space: nowrap;
}

.optimization-card__metric {
  flex-shrink: 0;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-color) 12%, transparent);
  color: var(--accent-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.65rem;
  white-space: nowrap;
}

.optimization-card__chevron {
  margin-left: auto;
  transition: transform 0.15s ease;
}

.optimization-card__chevron.is-open {
  transform: rotate(180deg);
}

.optimization-card__body {
  display: grid;
  gap: 0.25rem;
  padding: 0.25rem 0.75rem 0.625rem;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 55%, transparent);
}

.optimization-card__row {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

.optimization-card__turn {
  flex-shrink: 0;
  min-width: 5.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.optimization-card__action {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--text-primary);
}

.optimization-card__badge {
  flex-shrink: 0;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 45%, transparent);
  font-size: 0.625rem;
  white-space: nowrap;
}

.optimization-card__badge--good {
  background: color-mix(in srgb, var(--accent-color) 16%, transparent);
  color: var(--accent-color);
}

.optimization-card__badge--info {
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}

.optimization-card__badge--muted {
  color: var(--text-secondary);
}

.optimization-card__badge--recovery {
  background: color-mix(in srgb, #e6a23c 16%, transparent);
  color: #e6a23c;
}

.optimization-card__counts {
  flex-shrink: 0;
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap;
}
</style>
