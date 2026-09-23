<template>
  <section
    class="frontend-qor-score"
    :class="[{ 'is-compact': compact }, `is-${status}`]"
    :aria-label="score.label"
  >
    <header>
      <div>
        <span>{{ score.label }}</span>
        <small>Scoring model v{{ score.scoringVersion }}</small>
      </div>
      <strong>
        <span>{{ formatScore(score.value) }}</span>
        / {{ formatScore(score.maximum) }}
      </strong>
    </header>

    <ol>
      <li v-for="component in score.components" :key="component.id">
        <div class="frontend-qor-score__component-head">
          <span>{{ component.label }}</span>
          <strong>
            {{ formatScore(component.earned) }} / {{ formatScore(component.possible) }}
          </strong>
        </div>
        <div
          class="frontend-qor-score__track"
          role="progressbar"
          :aria-label="component.label"
          :aria-valuenow="component.earned"
          aria-valuemin="0"
          :aria-valuemax="component.possible"
        >
          <i :style="{ width: `${componentPercent(component)}%` }"></i>
        </div>
        <p>{{ component.summary }}</p>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import type {
  FrontendQorScore,
  FrontendQorScoreComponent,
  FrontendQorStatus,
} from '@/utils/frontendQor'

withDefaults(
  defineProps<{
    score: FrontendQorScore
    status: FrontendQorStatus
    compact?: boolean
  }>(),
  { compact: false },
)

function componentPercent(component: FrontendQorScoreComponent): number {
  return Math.max(0, Math.min(100, (component.earned / component.possible) * 100))
}

function formatScore(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
}
</script>

<style scoped>
.frontend-qor-score {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.frontend-qor-score > header,
.frontend-qor-score__component-head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.frontend-qor-score > header > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.frontend-qor-score > header span {
  font-size: 12px;
  font-weight: 760;
}

.frontend-qor-score > header small {
  color: var(--text-secondary);
  font-size: 10px;
}

.frontend-qor-score > header > strong {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
}

.frontend-qor-score > header > strong > span {
  color: var(--accent-color);
  font-size: 24px;
}

.frontend-qor-score.is-pass > header > strong > span {
  color: var(--success-color);
}

.frontend-qor-score.is-blocked > header > strong > span {
  color: var(--danger-color);
}

.frontend-qor-score > ol {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.frontend-qor-score li {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 5px;
}

.frontend-qor-score__component-head span,
.frontend-qor-score__component-head strong {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frontend-qor-score__component-head span {
  color: var(--text-primary);
  font-weight: 700;
}

.frontend-qor-score__component-head strong {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.frontend-qor-score__track {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: color-mix(in srgb, var(--text-secondary) 18%, transparent);
}

.frontend-qor-score__track i {
  position: absolute;
  inset: 0 auto 0 0;
  max-width: 100%;
  border-radius: inherit;
  background: var(--accent-color);
}

.frontend-qor-score.is-pass .frontend-qor-score__track i {
  background: var(--success-color);
}

.frontend-qor-score.is-blocked .frontend-qor-score__track i {
  background: var(--danger-color);
}

.frontend-qor-score li p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 1.35;
}

.frontend-qor-score.is-compact {
  gap: 9px;
}

.frontend-qor-score.is-compact > header > strong > span {
  font-size: 18px;
}

.frontend-qor-score.is-compact > ol {
  gap: 8px 12px;
}

@media (max-width: 620px) {
  .frontend-qor-score > ol {
    grid-template-columns: 1fr;
  }
}
</style>
