<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="ECC Environment Diagnostics"
    :style="{ width: '760px', maxWidth: 'calc(100vw - 48px)' }"
    :contentStyle="{ padding: '0' }"
    :draggable="false"
    class="doctor-dialog"
  >
    <div class="doctor-content">
      <div v-if="loading" class="doctor-loading" role="status">
        <i class="ri-loader-4-line doctor-spinner" />
        Running <code>ecc doctor --json</code>...
      </div>

      <div v-else-if="error" class="doctor-error" role="alert">
        <div>
          <strong>Environment diagnostics failed</strong>
          <p>{{ error }}</p>
        </div>
        <button type="button" class="doctor-secondary" @click="runDoctor">
          Try again
        </button>
      </div>

      <template v-else-if="result">
        <section class="doctor-summary">
          <div class="doctor-summary-heading">
            <span class="doctor-status" :class="`is-${result.summary.status}`">
              {{ summaryStatusLabel(result.summary.status) }}
            </span>
            <span class="doctor-counts">
              {{ result.summary.checked }} checked · {{ result.summary.failed }} failed ·
              {{ result.summary.attention }} attention
            </span>
          </div>
          <p v-if="result.summary.detail" class="doctor-version">
            {{ result.summary.detail }}
          </p>
          <p class="doctor-context">
            {{
              result.projectPath
                ? `Workspace: ${result.projectPath}`
                : 'No active workspace. PDK validation is skipped.'
            }}
          </p>
          <p v-if="result.summary.installedAt" class="doctor-context">
            ECC installed/updated: {{ formatTimestamp(result.summary.installedAt) }}
            (filesystem time, approximate)
          </p>
        </section>

        <div class="doctor-table-wrap">
          <table class="doctor-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Status</th>
                <th>Details</th>
                <th>Installed/updated</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="component in result.components" :key="component.component">
                <td class="doctor-component">
                  {{ component.component }}
                  <span v-if="component.required" class="doctor-required">required</span>
                </td>
                <td>
                  <span class="doctor-status" :class="`is-${component.status}`">
                    {{ componentStatusLabel(component.status) }}
                  </span>
                </td>
                <td class="doctor-detail">
                  <span v-if="component.detail">{{ component.detail }}</span>
                  <span v-if="component.remediation" class="doctor-remediation">
                    {{ component.remediation }}
                  </span>
                </td>
                <td class="doctor-installed">
                  {{
                    component.installedAt ? formatTimestamp(component.installedAt) : '—'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="doctor-actions">
          <span>The PDK check requires an active workspace.</span>
          <button type="button" class="doctor-secondary" @click="runDoctor">
            <i class="ri-refresh-line" />
            Run again
          </button>
        </div>
      </template>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import type {
  EnvironmentDoctorComponentStatus,
  EnvironmentDoctorResult,
  EnvironmentDoctorStatus,
} from '@ecos-studio/shared'
import { fetchEnvironmentDoctor } from '@/api/environmentDoctor'

const visible = defineModel<boolean>({ required: true })
const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<EnvironmentDoctorResult | null>(null)
let requestId = 0

function summaryStatusLabel(status: EnvironmentDoctorStatus): string {
  switch (status) {
    case 'ok':
      return 'Environment ready'
    case 'attention':
      return 'Needs attention'
    case 'failed':
      return 'Missing required tools'
    default:
      return 'Unknown status'
  }
}

function componentStatusLabel(status: EnvironmentDoctorComponentStatus): string {
  switch (status) {
    case 'pass':
      return 'Pass'
    case 'fail':
      return 'Fail'
    case 'skip':
      return 'Skip'
    default:
      return 'Unknown'
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

async function runDoctor(): Promise<void> {
  const currentRequest = ++requestId
  loading.value = true
  error.value = null
  try {
    const next = await fetchEnvironmentDoctor()
    if (currentRequest === requestId) result.value = next
  } catch (err) {
    if (currentRequest === requestId) {
      result.value = null
      error.value = err instanceof Error ? err.message : String(err)
    }
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

watch(
  visible,
  (open) => {
    if (open) void runDoctor()
  },
  { immediate: true },
)
</script>

<style>
.doctor-dialog.p-dialog {
  background: var(--bg-primary) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5) !important;
}

.doctor-dialog .p-dialog-header {
  color: var(--text-primary);
}

.doctor-dialog .p-dialog-content {
  background: transparent;
}
</style>

<style scoped>
.doctor-content {
  min-height: 160px;
  color: var(--text-primary);
}

.doctor-loading,
.doctor-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 24px;
  color: var(--text-secondary);
  font-size: 13px;
}

.doctor-loading code {
  font-family: monospace;
}

.doctor-spinner {
  animation: doctor-spin 0.9s linear infinite;
}

.doctor-error {
  align-items: flex-start;
  justify-content: space-between;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--danger-color, #e05252) 50%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--danger-color, #e05252) 8%, transparent);
}

.doctor-error strong {
  color: var(--text-primary);
}

.doctor-error p {
  margin: 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.doctor-summary {
  padding: 18px 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.doctor-summary-heading,
.doctor-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.doctor-counts,
.doctor-context,
.doctor-actions span {
  color: var(--text-secondary);
  font-size: 12px;
}

.doctor-version {
  margin: 10px 0 0;
  font-family: monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.doctor-context {
  margin: 6px 0 0;
  overflow-wrap: anywhere;
}

.doctor-status {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.doctor-status.is-ok,
.doctor-status.is-pass {
  color: #72d49a;
  background: rgba(114, 212, 154, 0.12);
}

.doctor-status.is-attention,
.doctor-status.is-skip,
.doctor-status.is-unknown {
  color: #e8bd68;
  background: rgba(232, 189, 104, 0.12);
}

.doctor-status.is-failed,
.doctor-status.is-fail {
  color: #ef8181;
  background: rgba(239, 129, 129, 0.12);
}

.doctor-table-wrap {
  max-height: min(52vh, 520px);
  overflow: auto;
}

.doctor-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.doctor-table th {
  position: sticky;
  top: 0;
  padding: 9px 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}

.doctor-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  vertical-align: top;
}

.doctor-component {
  min-width: 115px;
  font-weight: 600;
}

.doctor-required {
  display: block;
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 400;
}

.doctor-detail {
  max-width: 300px;
  overflow-wrap: anywhere;
}

.doctor-detail span {
  display: block;
}

.doctor-remediation {
  margin-top: 4px;
  color: #e8bd68;
}

.doctor-installed {
  min-width: 150px;
  color: var(--text-secondary);
}

.doctor-actions {
  padding: 14px 24px;
}

.doctor-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
}

.doctor-secondary:hover {
  color: var(--text-primary);
}

@keyframes doctor-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
