<template>
  <section
    v-if="criticalPaths && (criticalPaths.setup.length || criticalPaths.hold.length)"
    class="timing-paths-card"
  >
    <header class="timing-subheader">
      <h3>Critical Paths</h3>
      <span class="timing-hint">worst slack first · stage delay waterfall</span>
    </header>
    <div v-for="group in pathGroups" :key="group.id" class="timing-path-group">
      <h4>{{ group.title }}</h4>
      <article v-for="path in group.paths" :key="path.id" class="timing-path-card">
        <header>
          <strong>{{ path.id.split(':').slice(1).join(':') || path.id }}</strong>
          <span :class="slackClass(path.slackNs)"
            >{{ formatSlack(path.slackNs) }} ns</span
          >
          <small>{{ path.stageCount }} stages · {{ path.corner }}</small>
        </header>
        <div class="timing-path-waterfall" aria-hidden="true">
          <span
            v-for="(stage, index) in path.stages"
            :key="`${path.id}-${index}`"
            :style="{ flexGrow: Math.max(stage.delayNs ?? 0, 0.01) }"
            :title="stageTitle(stage, index)"
          />
        </div>
        <ol class="timing-path-stages">
          <li v-for="(stage, index) in path.stages" :key="`${path.id}-stage-${index}`">
            <span>{{ stage.pin || `stage ${index + 1}` }}</span>
            <small>{{ stage.cell }}</small>
            <em>{{ formatDelay(stage.delayNs) }}</em>
          </li>
        </ol>
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

.timing-path-card header {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.timing-path-card header strong {
  color: var(--text-primary);
  font-size: 11px;
}

.timing-path-card header span {
  font-variant-numeric: tabular-nums;
}

.timing-path-card header span.is-good {
  color: var(--success-color);
}

.timing-path-card header span.is-bad {
  color: var(--danger-color);
}

.timing-path-card header span.is-missing {
  color: var(--text-secondary);
}

.timing-path-card header small {
  color: var(--text-secondary);
  font-size: 9px;
}

.timing-path-waterfall {
  display: flex;
  gap: 1px;
  height: 10px;
  overflow: hidden;
}

.timing-path-waterfall span {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 70%, transparent);
  min-width: 2px;
}

.timing-path-waterfall span:nth-child(odd) {
  background: color-mix(in srgb, var(--accent-color, #3b82f6) 42%, transparent);
}

.timing-path-stages {
  display: flex;
  flex-direction: column;
  gap: 2px;
  list-style: none;
  margin: 0;
  max-height: 120px;
  overflow-y: auto;
  padding: 0;
}

.timing-path-stages li {
  color: var(--text-secondary);
  display: grid;
  font-size: 10px;
  gap: 8px;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 64px;
}

.timing-path-stages em {
  font-style: normal;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
