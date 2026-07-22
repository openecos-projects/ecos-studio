<template>
  <Dialog
    :visible="visible"
    modal
    header="Signoff Package Review"
    :style="{ width: 'min(920px, calc(100vw - 32px))' }"
    :closable="!loading"
    :draggable="false"
    class="signoff-package-review-dialog"
    @update:visible="handleVisibilityChange"
  >
    <div class="signoff-package-review-content">
      <div v-if="loading" class="signoff-package-review-loading" role="status">
        <i class="ri-loader-4-line animate-spin" aria-hidden="true" />
        <span>Rechecking current signoff outputs...</span>
      </div>

      <div v-else-if="error" class="signoff-package-review-error" role="alert">
        <i class="ri-error-warning-line" aria-hidden="true" />
        <p>{{ error }}</p>
      </div>

      <template v-else-if="result">
        <section class="signoff-package-review-status" :class="`is-${result.status}`">
          <i :class="statusIcon(result.status)" aria-hidden="true" />
          <div>
            <strong>{{ statusLabel(result.status) }}</strong>
            <p>{{ statusSummary(result.status) }}</p>
          </div>
          <button
            type="button"
            class="signoff-package-review-refresh"
            title="Recheck current outputs"
            aria-label="Recheck current outputs"
            @click="emit('refresh')"
          >
            <i class="ri-refresh-line" aria-hidden="true" />
          </button>
        </section>

        <div class="signoff-package-review-panels">
          <section
            class="signoff-package-review-panel signoff-package-review-resource-panel"
            aria-labelledby="signoff-resource-summary"
          >
            <h3 id="signoff-resource-summary">Resource Summary</h3>
            <ul class="signoff-package-review-groups">
              <li v-for="group in result.groups" :key="group.id">
                <i
                  :class="statusIcon(group.status)"
                  :data-status="group.status"
                  aria-hidden="true"
                />
                <div>
                  <strong>{{ group.label }}</strong>
                  <span>{{ group.summary }}</span>
                </div>
                <span class="signoff-package-review-count"
                  >{{ group.available }}/{{ group.expected }}</span
                >
              </li>
            </ul>
          </section>

          <section
            v-if="result.risks.length"
            class="signoff-package-review-panel signoff-package-review-risk-panel"
            aria-labelledby="signoff-risk-summary"
          >
            <h3 id="signoff-risk-summary">Risk Details</h3>
            <ul class="signoff-package-review-risks">
              <li
                v-for="risk in result.risks"
                :key="`${risk.severity}-${risk.title}`"
                :data-severity="risk.severity"
              >
                <i
                  :class="
                    risk.severity === 'blocked' ? 'ri-close-circle-line' : 'ri-alert-line'
                  "
                  aria-hidden="true"
                />
                <div class="signoff-package-review-risk-copy">
                  <strong>{{ risk.title }}</strong>
                  <span>{{ risk.summary }}</span>
                </div>
                <dl v-if="risk.details.length" class="signoff-package-review-details">
                  <div v-for="detail in risk.details" :key="detailKey(detail)">
                    <dt>
                      <span :data-kind="detail.kind">{{
                        detailKindLabel(detail.kind)
                      }}</span>
                      <strong>{{ detail.label }}</strong>
                    </dt>
                    <dd>
                      <code>{{ detail.location }}</code>
                      <span>{{ detail.reason }}</span>
                    </dd>
                  </div>
                </dl>
              </li>
            </ul>
          </section>
        </div>
      </template>

      <div v-else class="signoff-package-review-loading" role="status">
        <i class="ri-loader-4-line animate-spin" aria-hidden="true" />
        <span>Preparing signoff package review...</span>
      </div>
    </div>

    <template #footer>
      <div class="signoff-package-review-actions">
        <button
          type="button"
          class="signoff-package-review-secondary"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          v-if="error"
          type="button"
          class="signoff-package-review-secondary"
          @click="emit('refresh')"
        >
          Retry
        </button>
        <button
          type="button"
          class="signoff-package-review-primary"
          :disabled="loading || Boolean(error) || !result || result.status === 'blocked'"
          @click="emit('export')"
        >
          Export Package
        </button>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import type {
  EccSignoffReviewStatus,
  EccWorkspaceInspectSignoffResult,
} from '@ecos-studio/shared'
import Dialog from 'primevue/dialog'

defineProps<{
  error: string
  loading: boolean
  result: EccWorkspaceInspectSignoffResult | null
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  export: []
  refresh: []
}>()

function handleVisibilityChange(nextVisible: boolean): void {
  if (!nextVisible) emit('close')
}

function statusIcon(status: EccSignoffReviewStatus): string {
  if (status === 'ready') return 'ri-checkbox-circle-line'
  if (status === 'attention') return 'ri-alert-line'
  return 'ri-close-circle-line'
}

function statusLabel(status: EccSignoffReviewStatus): string {
  if (status === 'ready') return 'Ready to Export'
  if (status === 'attention') return 'Export With Attention'
  return 'Export Blocked'
}

function statusSummary(status: EccSignoffReviewStatus): string {
  if (status === 'ready') return 'All required signoff resources are ready.'
  if (status === 'attention')
    return 'Required resources are ready; review the listed risks before exporting.'
  return 'Resolve the blocking resources before exporting this package.'
}

function detailKindLabel(
  kind: 'resource' | 'flow' | 'checklist' | 'analysis' | 'freshness',
): string {
  if (kind === 'resource') return 'Resource'
  if (kind === 'flow') return 'Flow'
  if (kind === 'analysis') return 'QoR Analysis'
  if (kind === 'freshness') return 'Analysis Refresh'
  return 'Checklist'
}

function detailKey(detail: {
  kind: string
  label: string
  location: string
  reason: string
}): string {
  return `${detail.kind}-${detail.label}-${detail.location}-${detail.reason}`
}
</script>

<style>
.signoff-package-review-dialog.p-dialog {
  background: var(--bg-primary) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 8px !important;
  color: var(--text-primary) !important;
}

.signoff-package-review-dialog .p-dialog-header,
.signoff-package-review-dialog .p-dialog-content,
.signoff-package-review-dialog .p-dialog-footer {
  background: transparent;
  color: var(--text-primary);
}

.signoff-package-review-dialog .p-dialog-header {
  padding: 18px 20px 10px;
}

.signoff-package-review-dialog .p-dialog-content {
  padding: 12px 20px;
}

.signoff-package-review-dialog .p-dialog-footer {
  padding: 12px 20px 18px;
}
</style>

<style scoped>
.signoff-package-review-content {
  display: grid;
  gap: 16px;
}

.signoff-package-review-loading,
.signoff-package-review-error {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  gap: 10px;
  min-height: 120px;
  justify-content: center;
}

.signoff-package-review-error {
  color: var(--danger-color);
}

.signoff-package-review-error p {
  margin: 0;
}

.signoff-package-review-status {
  align-items: center;
  background: color-mix(in srgb, var(--bg-secondary) 76%, var(--bg-primary));
  border: 1px solid var(--border-color);
  display: grid;
  gap: 12px;
  grid-template-columns: auto 1fr auto;
  min-height: 68px;
  padding: 12px 14px;
}

.signoff-package-review-status.is-ready {
  border-color: color-mix(in srgb, var(--success-color) 42%, var(--border-color));
  background: color-mix(in srgb, var(--success-bg) 72%, var(--bg-primary));
}

.signoff-package-review-status.is-attention {
  border-color: color-mix(in srgb, var(--warn-color) 42%, var(--border-color));
  background: color-mix(in srgb, var(--warn-bg) 72%, var(--bg-primary));
}

.signoff-package-review-status.is-blocked {
  border-color: color-mix(in srgb, var(--danger-color) 42%, var(--border-color));
  background: color-mix(in srgb, var(--danger-bg) 72%, var(--bg-primary));
}

.signoff-package-review-status > i {
  font-size: 22px;
}

.signoff-package-review-status.is-ready > i,
.signoff-package-review-groups [data-status='ready'] {
  color: var(--success-color);
}

.signoff-package-review-status.is-attention > i,
.signoff-package-review-groups [data-status='attention'] {
  color: var(--warn-color);
}

.signoff-package-review-status.is-blocked > i,
.signoff-package-review-groups [data-status='blocked'],
.signoff-package-review-risks [data-severity='blocked'] > i {
  color: var(--danger-color);
}

.signoff-package-review-risks [data-severity='warning'] > i {
  color: var(--warn-color);
}

.signoff-package-review-status strong,
.signoff-package-review-groups strong,
.signoff-package-review-risks strong,
.signoff-package-review-details strong {
  color: var(--text-primary);
  font-size: 13px;
}

.signoff-package-review-status p,
.signoff-package-review-groups span,
.signoff-package-review-risks span,
.signoff-package-review-details span {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 3px 0 0;
}

.signoff-package-review-refresh {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  display: inline-flex;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.signoff-package-review-refresh:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.signoff-package-review-panels {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(210px, 0.72fr) minmax(0, 1.28fr);
  min-width: 0;
}

.signoff-package-review-panel {
  min-width: 0;
}

.signoff-package-review-resource-panel {
  border-right: 1px solid var(--border-color);
  padding-right: 18px;
}

.signoff-package-review-panel h3 {
  font-size: 12px;
  font-weight: 600;
  margin: 0 0 8px;
}

.signoff-package-review-groups,
.signoff-package-review-risks {
  border-top: 1px solid var(--border-color);
  list-style: none;
  margin: 0;
  padding: 0;
}

.signoff-package-review-groups li,
.signoff-package-review-risks li {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: grid;
  gap: 10px;
  grid-template-columns: 18px 1fr auto;
  min-height: 48px;
  padding: 7px 0;
}

.signoff-package-review-risks li {
  align-items: start;
  column-gap: 10px;
  grid-template-columns: 18px minmax(0, 1fr);
  padding: 10px 0;
}

.signoff-package-review-groups li > div,
.signoff-package-review-risk-copy {
  display: grid;
}

.signoff-package-review-count {
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 12px;
}

.signoff-package-review-risk-panel {
  max-height: min(52vh, 520px);
  overflow: auto;
  padding-right: 4px;
}

.signoff-package-review-details {
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  display: grid;
  gap: 0;
  grid-column: 2;
  margin: 9px 0 0;
  min-width: 0;
}

.signoff-package-review-details > div {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 62%, transparent);
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(132px, 0.52fr) minmax(0, 1fr);
  padding: 9px 0;
}

.signoff-package-review-details dt,
.signoff-package-review-details dd {
  display: grid;
  gap: 4px;
  margin: 0;
  min-width: 0;
}

.signoff-package-review-details dt > span {
  align-self: start;
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
  color: var(--accent-color);
  font-size: 10px;
  font-weight: 600;
  justify-self: start;
  line-height: 16px;
  padding: 0 5px;
}

.signoff-package-review-details [data-kind='flow'] {
  background: color-mix(in srgb, var(--danger-bg) 70%, transparent);
  color: var(--danger-color);
}

.signoff-package-review-details [data-kind='checklist'] {
  background: color-mix(in srgb, var(--warn-bg) 70%, transparent);
  color: var(--warn-color);
}

.signoff-package-review-details [data-kind='analysis'] {
  background: color-mix(in srgb, var(--danger-bg) 60%, transparent);
  color: var(--danger-color);
}

.signoff-package-review-details [data-kind='freshness'] {
  background: color-mix(in srgb, var(--warn-bg) 70%, transparent);
  color: var(--warn-color);
}

.signoff-package-review-details code {
  background: var(--bg-secondary);
  border: 1px solid color-mix(in srgb, var(--border-color) 84%, transparent);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 17px;
  overflow-wrap: anywhere;
  padding: 2px 5px;
  white-space: normal;
}

.signoff-package-review-actions {
  border-top: 1px solid var(--border-color);
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 12px;
}

.signoff-package-review-actions button {
  border-radius: 6px;
  font-size: 13px;
  min-height: 32px;
  padding: 0 12px;
}

.signoff-package-review-secondary {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.signoff-package-review-primary {
  background: var(--accent-color);
  border: 1px solid var(--accent-color);
  color: white;
}

.signoff-package-review-primary:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

@media (max-width: 760px) {
  .signoff-package-review-panels {
    grid-template-columns: minmax(0, 1fr);
  }

  .signoff-package-review-resource-panel {
    border-bottom: 1px solid var(--border-color);
    border-right: 0;
    padding-bottom: 16px;
    padding-right: 0;
  }

  .signoff-package-review-risk-panel {
    max-height: min(46vh, 460px);
  }
}

@media (max-width: 560px) {
  .signoff-package-review-groups li {
    grid-template-columns: 18px 1fr;
  }

  .signoff-package-review-count {
    grid-column: 2;
  }

  .signoff-package-review-details {
    grid-column: 1 / -1;
  }

  .signoff-package-review-details > div {
    gap: 6px;
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
