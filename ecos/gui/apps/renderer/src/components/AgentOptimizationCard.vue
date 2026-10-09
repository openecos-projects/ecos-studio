<template>
  <section
    class="optimization-card"
    :data-state="failureState ? 'error' : liveState ? 'running' : 'done'"
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
        v-if="statusLabel"
        class="optimization-card__badge"
        :class="
          failureState
            ? 'optimization-card__badge--error'
            : 'optimization-card__badge--muted'
        "
      >
        {{ statusLabel }}
      </span>
      <span
        v-if="optimization.recovery_stage && optimization.recovery_stage !== 'original'"
        class="optimization-card__badge optimization-card__badge--recovery"
      >
        {{ failureState ? 'recovery' : 'recovering' }} {{ optimization.recovery_stage }}
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

    <div v-if="failureState" class="optimization-card__error" role="alert">
      <i class="ri-error-warning-line" aria-hidden="true"></i>
      <span>
        {{
          optimization.rationale_summary ||
          optimization.rejection_reason ||
          'Optimization stopped and needs attention.'
        }}
      </span>
    </div>

    <div v-show="expanded" class="optimization-card__body">
      <div class="optimization-card__row optimization-card__summary">
        <i class="ri-pulse-line" aria-hidden="true"></i>
        <span>{{ progressLabel }}</span>
        <span v-if="optimization.in_flight" class="optimization-card__badge">
          {{ optimization.in_flight }} in flight
        </span>
        <span
          v-if="latestOutcome"
          class="optimization-card__badge"
          :class="outcomeBadgeClass(latestOutcome)"
        >
          {{ latestOutcome }}
        </span>
        <span
          v-if="optimization.recovery_transition"
          class="optimization-card__badge optimization-card__badge--recovery"
        >
          {{ optimization.recovery_transition }}
        </span>
      </div>
      <p v-if="optimization.rationale_summary" class="optimization-card__rationale">
        {{ optimization.rationale_summary }}
      </p>
      <p v-if="optimization.rejection_reason" class="optimization-card__rejection">
        Rejected: {{ optimization.rejection_reason }}
      </p>
      <div v-if="controllableEpisode" class="optimization-card__controls">
        <button
          v-if="optimization.state === 'paused' || optimization.state === 'interrupted'"
          type="button"
          aria-label="Resume optimization"
          title="Resume optimization"
          @click="$emit('control', 'resume')"
        >
          <i class="ri-play-fill" aria-hidden="true"></i>
        </button>
        <button
          v-else-if="optimization.state === 'needs_attention'"
          type="button"
          aria-label="Retry optimization"
          title="Retry optimization"
          @click="$emit('control', 'retry')"
        >
          <i class="ri-restart-line" aria-hidden="true"></i>
        </button>
        <button
          v-else-if="optimization.state !== 'stopping'"
          type="button"
          aria-label="Pause optimization"
          title="Pause optimization"
          @click="$emit('control', 'pause')"
        >
          <i class="ri-pause-fill" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          aria-label="Stop optimization"
          title="Stop optimization"
          :disabled="optimization.state === 'stopping'"
          @click="$emit('control', 'stop')"
        >
          <i class="ri-stop-fill" aria-hidden="true"></i>
        </button>
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

defineEmits<{
  control: [action: 'pause' | 'resume' | 'retry' | 'stop']
}>()

const expanded = ref(true)

const LIVE_STATES = new Set([
  'created',
  'starting',
  'calibrating',
  'planning',
  'awaiting_execution',
  'executing',
  'running',
  'paused',
  'stopping',
])

const liveState = computed(() => {
  const state = props.optimization.state
  return typeof state === 'string' && LIVE_STATES.has(state)
})

const failureState = computed(() =>
  ['error', 'escalated', 'quarantined', 'unavailable', 'needs_attention'].includes(
    props.optimization.state ?? '',
  ),
)

const statusLabel = computed(() => {
  const labels: Record<string, string> = {
    error: 'Failed',
    escalated: 'Needs attention',
    quarantined: 'Quarantined',
    unavailable: 'Unavailable',
    needs_attention: 'Needs attention',
    running: 'Running',
    calibrating: 'Calibrating',
    paused: 'Paused',
    interrupted: 'Interrupted',
    stopping: 'Stopping',
    stopped: 'Stopped',
    completed: 'Completed',
  }
  return labels[props.optimization.state ?? ''] ?? null
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

const controllableEpisode = computed(() =>
  [...LIVE_STATES, 'interrupted', 'needs_attention'].includes(
    props.optimization.state ?? '',
  ),
)

const progressLabel = computed(() => {
  const completed = props.optimization.calibration_completed
  const required = props.optimization.calibration_required
  if (required && completed !== undefined) return `Replay ${completed}/${required}`
  const turn = props.optimization.turn_count ?? props.optimization.turn
  if (turn) return `Turn ${turn}`
  const phase = props.optimization.phase ?? props.optimization.state
  return phase ? phase.replace(/_/g, ' ') : 'Preparing'
})

const latestOutcome = computed(() => {
  const latest = [...props.timeline]
    .reverse()
    .find(
      (entry) => entry.outcome || entry.incumbent_decision || entry.recovery_transition,
    )
  return (
    props.optimization.outcome ??
    props.optimization.incumbent_decision ??
    latest?.outcome ??
    latest?.incumbent_decision ??
    null
  )
})

const BAD_OUTCOMES = new Set([
  'degraded',
  'infeasible',
  'execution_failed',
  'evidence_invalid',
  'timed_out_cancelled',
  'indeterminate',
])

function outcomeBadgeClass(outcome: string | null | undefined): string {
  if (!outcome) return 'optimization-card__badge--muted'
  if (outcome === 'improved' || outcome === 'tradeoff') {
    return 'optimization-card__badge--good'
  }
  return BAD_OUTCOMES.has(outcome)
    ? 'optimization-card__badge--recovery'
    : 'optimization-card__badge--muted'
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
  flex-wrap: wrap;
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
  min-width: 0;
  overflow-wrap: anywhere;
}

.optimization-card__error {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--border-color);
  background: var(--danger-bg);
  color: var(--danger-color);
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.optimization-card__error > i {
  flex-shrink: 0;
}

.optimization-card__error > span {
  min-width: 0;
}

.optimization-card__rejection {
  flex-basis: 100%;
  color: var(--danger-color);
  overflow-wrap: anywhere;
}

.optimization-card__badge--error {
  background: var(--danger-bg);
  color: var(--danger-color);
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

.optimization-card__summary {
  padding: 0.2rem 0 0.35rem;
  border-bottom: 1px dashed color-mix(in srgb, var(--border-color) 45%, transparent);
  color: var(--text-primary);
  font-size: 0.6875rem;
}

.optimization-card__delta {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.optimization-card__delta--better {
  color: var(--accent-color);
}

.optimization-card__delta--worse {
  color: #e6a23c;
}

.optimization-card__rationale {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.optimization-card__controls {
  display: flex;
  justify-content: flex-end;
  gap: 0.25rem;
}

.optimization-card__controls button {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.optimization-card__controls button:hover:not(:disabled) {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.optimization-card__controls button:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
