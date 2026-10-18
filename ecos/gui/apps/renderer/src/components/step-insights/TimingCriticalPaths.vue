<template>
  <section
    v-if="criticalPaths && (criticalPaths.setup.length || criticalPaths.hold.length)"
    class="timing-paths-card"
  >
    <header class="timing-subheader">
      <h3>Critical Paths</h3>
      <span class="timing-hint">worst slack first · stage delay waterfall</span>
    </header>
    <p v-if="truncationNote" class="timing-truncation-note">
      <i class="ri-information-line" aria-hidden="true" />
      <span>{{ truncationNote }}</span>
    </p>
    <div v-for="group in pathGroups" :key="group.id" class="timing-path-group">
      <h4>{{ group.title }} · {{ group.paths.length }} paths</h4>
      <article v-for="path in group.paths" :key="path.id" class="timing-path-card">
        <details>
          <summary>
            <strong>{{ path.id.split(':').slice(1).join(':') || path.id }}</strong>
            <span :class="slackClass(path.slackNs)"
              >{{ formatSlack(path.slackNs) }} ns</span
            >
            <small>{{ path.stageCount }} stages · {{ path.corner }}</small>
            <small v-if="path.pathGroup">Group: {{ path.pathGroup }}</small>
            <span v-if="path.startPoint || path.endPoint" class="timing-path-endpoints"
              >{{ path.startPoint || '—' }} → {{ path.endPoint || '—' }}</span
            >
          </summary>
          <div class="timing-path-waterfall" aria-hidden="true">
            <span
              v-for="(stage, index) in path.stages"
              :key="`${path.id}-${index}`"
              :style="{ flexGrow: Math.max(stage.delayNs ?? 0, 0.01) }"
              :title="stageTitle(stage, index)"
            />
          </div>
          <div class="timing-path-stage-scroll">
            <table class="timing-path-stages" :aria-label="`${path.id} stages`">
              <thead>
                <tr>
                  <th scope="col">Pin</th>
                  <th scope="col">Cell</th>
                  <th scope="col">Delay (ns)</th>
                  <th scope="col">Arrival (ns)</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(stage, index) in path.stages"
                  :key="`${path.id}-stage-${index}`"
                >
                  <td>{{ stage.pin || `stage ${index + 1}` }}</td>
                  <td>{{ stage.cell || '—' }}</td>
                  <td>{{ formatDelay(stage.delayNs) }}</td>
                  <td>{{ formatDelay(stage.arrivalNs) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  StaCriticalPath,
  StaCriticalPathsModel,
  StaPathStage,
} from '../flow-insights/flowInsightsData'
import { formatDelay, formatSlack, slackClass } from './timingFormat'

const props = defineProps<{
  criticalPaths: StaCriticalPathsModel | null
  /** Corner attribution shown in the group titles, e.g. the worst-slack corner. */
  setupCorner?: string | null
  holdCorner?: string | null
}>()

const pathGroups = computed<
  Array<{ id: string; title: string; paths: StaCriticalPath[] }>
>(() => {
  const groups: Array<{ id: string; title: string; paths: StaCriticalPath[] }> = []
  if (props.criticalPaths?.setup.length) {
    groups.push({
      id: 'setup',
      title: `Worst setup${props.setupCorner ? ` @ ${props.setupCorner}` : ''}`,
      paths: props.criticalPaths.setup,
    })
  }
  if (props.criticalPaths?.hold.length) {
    groups.push({
      id: 'hold',
      title: `Worst hold${props.holdCorner ? ` @ ${props.holdCorner}` : ''}`,
      paths: props.criticalPaths.hold,
    })
  }
  return groups
})

// Projection truncation truth: the preview carries issueCount/issuesTruncated;
// the GUI states the bound instead of assuming a tool-side path limit.
const truncationNote = computed(() => {
  const model = props.criticalPaths
  if (!model?.issuesTruncated) return ''
  const shown = model.setup.length + model.hold.length
  const total = model.issueCount
  return typeof total === 'number' && total > shown
    ? `Showing the ${shown} worst-slack issues of ${total} committed. The full list loads on demand from the STA timing issues artifact.`
    : `Showing the ${shown} worst-slack issues. The full list loads on demand from the STA timing issues artifact.`
})

function stageTitle(stage: StaPathStage, index: number): string {
  const pin = stage.pin || `stage ${index + 1}`
  const cell = stage.cell ? ` · ${stage.cell}` : ''
  return `${pin}${cell} · ${formatDelay(stage.delayNs)}`
}
</script>

<style scoped>
.timing-paths-card {
  background: color-mix(in srgb, var(--bg-primary) 74%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
}

.timing-subheader {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
}

.timing-subheader h3 {
  color: var(--text-primary);
  font-size: 12px;
  margin: 0;
}

.timing-hint {
  color: var(--text-secondary);
  font-size: 9px;
}

.timing-truncation-note {
  align-items: center;
  background: color-mix(in srgb, var(--accent-color) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-color) 30%, transparent);
  border-radius: 6px;
  color: var(--text-secondary);
  display: flex;
  font-size: 10px;
  gap: 6px;
  margin: 0;
  padding: 6px 8px;
}

.timing-path-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.timing-path-group h4 {
  color: var(--text-primary);
  font-size: 11px;
  margin: 0;
}

.timing-path-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}

.timing-path-card summary {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  cursor: pointer;
  list-style: none;
}

.timing-path-card summary::before {
  content: '▸';
  color: var(--text-secondary);
}

.timing-path-card details[open] summary::before {
  content: '▾';
}

.timing-path-endpoints {
  color: var(--text-secondary);
  flex-basis: 100%;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.timing-path-card summary strong {
  color: var(--text-primary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.timing-path-card summary span {
  font-variant-numeric: tabular-nums;
}

.timing-path-card summary span.is-good {
  color: var(--success-color);
}

.timing-path-card summary span.is-bad {
  color: var(--danger-color);
}

.timing-path-card summary span.is-missing {
  color: var(--text-secondary);
}

.timing-path-card summary small {
  color: var(--text-secondary);
  font-size: 11px;
}

.timing-path-waterfall {
  display: flex;
  gap: 1px;
  height: 10px;
  margin: 10px 0;
  overflow: hidden;
}

.timing-path-waterfall span {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 70%, transparent);
  min-width: 2px;
}

.timing-path-waterfall span:nth-child(odd) {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 42%, transparent);
}

.timing-path-stage-scroll {
  max-height: 320px;
  overflow: auto;
}

.timing-path-stages {
  border-collapse: collapse;
  color: var(--text-secondary);
  font-size: 12px;
  width: 100%;
}

.timing-path-stages th,
.timing-path-stages td {
  border-bottom: 1px solid var(--border-color);
  padding: 6px 8px;
  text-align: left;
}

.timing-path-stages th {
  background: var(--bg-secondary);
  position: sticky;
  top: 0;
}

.timing-path-stages td:nth-child(n + 3) {
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
</style>
