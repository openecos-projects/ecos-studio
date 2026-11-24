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
      <div
        v-if="optimization.state === 'calibrating' && optimization.calibration_required"
        class="optimization-card__calibration"
      >
        <strong>Baseline calibration</strong>
        <progress
          aria-label="Baseline replays completed"
          :value="optimization.calibration_completed ?? 0"
          :max="optimization.calibration_required"
        ></progress>
        <span>Candidate runs start after calibration.</span>
      </div>
      <div v-else class="optimization-card__row optimization-card__summary">
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
      <p v-if="planningContinues" class="optimization-card__rationale">
        Planning the next candidate…
      </p>
      <p v-else-if="budgetReached" class="optimization-card__rationale">
        Optimization budget reached.
      </p>
      <p
        v-else-if="optimization.rejection_reason && !plannerContinue && !failureState"
        class="optimization-card__rejection"
      >
        Rejected: {{ optimization.rejection_reason }}
      </p>
      <div v-if="resultMetric" class="optimization-card__result">
        <strong>Best candidate · {{ metricLabel(resultMetric.id) }}</strong>
        <p class="optimization-card__result-values">
          <template v-if="resultMetric.baseline !== null">
            Baseline {{ metricFormat.format(resultMetric.baseline) }} →
          </template>
          {{ metricFormat.format(resultMetric.candidate) }}
          <span v-if="resultChange">({{ resultChange }})</span>
        </p>
        <details v-if="resultMetrics.length > 1" class="optimization-card__comparison">
          <summary>Compare all metrics</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Baseline</th>
                <th scope="col">Best</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="metric in resultMetrics" :key="metric.id">
                <th scope="row">{{ metricLabel(metric.id) }}</th>
                <td>
                  {{
                    metric.baseline === null ? '—' : metricFormat.format(metric.baseline)
                  }}
                </td>
                <td>{{ metricFormat.format(metric.candidate) }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </div>
      <p v-else-if="finished" class="optimization-card__rationale">
        No verified best candidate was recorded.
      </p>
      <section
        v-if="rounds?.length"
        class="optimization-card__rounds"
        aria-label="Candidate rounds"
      >
        <h3>
          Candidate rounds
          <span>{{ finishedRounds }} / {{ rounds.length }} recorded</span>
        </h3>
        <details v-for="(round, index) in rounds" :key="round.interventionId">
          <summary>
            <span class="optimization-card__round-title">
              Round {{ index + 1 }}
              <span
                v-if="isBest(round)"
                class="optimization-card__badge optimization-card__badge--good"
                >Best</span
              >
            </span>
            <span class="optimization-card__round-metric">
              {{ round.metric ? metricFormat.format(round.metric.value) : '' }}
            </span>
            <span
              class="optimization-card__badge"
              :class="outcomeBadgeClass(round.outcome)"
            >
              {{
                round.outcome
                  ? outcomeLabel(round.outcome)
                  : finished
                    ? 'No result'
                    : 'Pending'
              }}
            </span>
          </summary>
          <dl>
            <template v-if="round.requested">
              <dt>Parameter</dt>
              <dd>
                <code>{{ round.requested.knob_id }}</code>
              </dd>
              <dt>Requested value</dt>
              <dd>{{ round.requested.value }}</dd>
            </template>
            <template v-if="round.metric">
              <dt>{{ metricLabel(round.metric.id) }}</dt>
              <dd>{{ metricFormat.format(round.metric.value) }}</dd>
            </template>
            <template v-if="round.decision">
              <dt>Decision</dt>
              <dd>{{ outcomeLabel(round.decision) }}</dd>
            </template>
            <template v-if="round.failedGates?.length">
              <dt>Failed checks</dt>
              <dd>{{ round.failedGates.map(metricLabel).join(', ') }}</dd>
            </template>
          </dl>
        </details>
      </section>
      <p
        v-else-if="finished && optimization.turn_count"
        class="optimization-card__rationale"
      >
        No candidate round details available.
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
        <p v-else-if="optimization.state === 'needs_attention'">
          This optimization needs recovery. Stop it safely before starting a new round.
        </p>
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
import type {
  DesktopAgentOptimizationPayload,
  DesktopAgentOptimizationRound,
} from '@ecos-studio/shared'

const props = defineProps<{
  optimization: DesktopAgentOptimizationPayload
  timeline: DesktopAgentOptimizationPayload[]
  rounds?: DesktopAgentOptimizationRound[]
}>()

defineEmits<{
  control: [action: 'pause' | 'resume' | 'stop']
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

const plannerContinue = computed(
  () => props.optimization.rejection_reason === 'planner_continue',
)

const planningContinues = computed(() => {
  const state = props.optimization.state
  return (
    plannerContinue.value && liveState.value && state !== 'paused' && state !== 'stopping'
  )
})

const failureState = computed(() =>
  [
    'error',
    'escalated',
    'quarantined',
    'unavailable',
    'needs_attention',
    'failed',
  ].includes(props.optimization.state ?? ''),
)

const budgetReached = computed(
  () =>
    props.optimization.state === 'stopped' &&
    props.optimization.rejection_reason === 'budget_exhausted' &&
    !props.optimization.recovery_incomplete,
)

const finished = computed(() =>
  [
    'completed',
    'stopped',
    'failed',
    'error',
    'escalated',
    'quarantined',
    'unavailable',
  ].includes(props.optimization.state ?? ''),
)
const resultMetrics = computed(() =>
  finished.value ? (props.optimization.best_candidate?.metrics ?? []) : [],
)
const resultMetric = computed(() => {
  const { active_primary_metric, original_primary_metric } = props.optimization
  const primaryMetric = original_primary_metric || active_primary_metric
  return (
    resultMetrics.value.find((metric) => metric.id === primaryMetric) ??
    resultMetrics.value[0] ??
    null
  )
})

const finishedRounds = computed(
  () => props.rounds?.filter((round) => round.outcome).length ?? 0,
)

function metricLabel(id: string): string {
  return id === 'route_wirelength' ? 'Routed wirelength' : id.replace(/_/g, ' ')
}

function outcomeLabel(value: string): string {
  if (value === 'incumbent_retained') return 'Kept previous best'
  if (value === 'candidate_better') return 'Became best candidate'
  const label = value.replace(/_/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function isBest(round: DesktopAgentOptimizationRound): boolean {
  return Boolean(
    round.manifestSha256 &&
    round.manifestSha256 === props.optimization.best_candidate?.manifest_sha256,
  )
}
const metricFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 })
const resultChangeFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 1,
})
const resultChange = computed(() => {
  const metric = resultMetric.value
  if (!metric || !metric.baseline) return null
  return resultChangeFormat.format(
    (metric.candidate - metric.baseline) / Math.abs(metric.baseline),
  )
})

const statusLabel = computed(() => {
  if (budgetReached.value) return 'Finished'
  const labels: Record<string, string> = {
    error: 'Failed',
    failed: 'Failed',
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
  if (props.rounds?.length) return `${props.rounds.length} candidates`
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
  'candidate_ineligible',
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
  max-width: 68rem;
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

.optimization-card__result {
  display: grid;
  gap: 0.25rem;
  padding: 0.625rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  background: var(--bg-primary);
  font-size: 0.75rem;
}

.optimization-card__calibration {
  display: grid;
  gap: 0.375rem;
  padding-block: 0.375rem;
  font-size: 0.75rem;
}

.optimization-card__calibration progress {
  appearance: none;
  width: 100%;
  height: 0.625rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--border-color);
  accent-color: var(--accent-color);
}

.optimization-card__calibration progress::-webkit-progress-bar {
  background: var(--border-color);
}

.optimization-card__calibration progress::-webkit-progress-value {
  background: var(--accent-color);
}

.optimization-card__calibration span {
  color: var(--text-secondary);
}

.optimization-card__result-values {
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}

.optimization-card__comparison table {
  width: 100%;
  margin-top: 0.375rem;
  border-collapse: collapse;
  font-size: 0.6875rem;
}

.optimization-card__comparison th,
.optimization-card__comparison td {
  padding: 0.25rem;
  border-top: 1px solid var(--border-color);
  text-align: right;
  overflow-wrap: anywhere;
}

.optimization-card__comparison th:first-child {
  text-align: left;
}

.optimization-card__rounds h3 {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.25rem;
  margin-block: 0.5rem 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.optimization-card__rounds h3 span {
  font-weight: 400;
  color: var(--text-secondary);
}

.optimization-card__rounds details {
  border-top: 1px solid var(--border-color);
  font-size: 0.75rem;
}

.optimization-card__rounds summary {
  padding-block: 0.4rem;
}

.optimization-card summary {
  cursor: pointer;
}

.optimization-card__round-title {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem;
  margin-inline: 0.125rem;
  font-weight: 600;
}

.optimization-card__round-metric {
  margin-inline-end: 0.25rem;
  font-variant-numeric: tabular-nums;
}

.optimization-card__rounds dl {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 0.25rem 0.5rem;
  padding: 0.375rem 0.625rem 0.625rem;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
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
