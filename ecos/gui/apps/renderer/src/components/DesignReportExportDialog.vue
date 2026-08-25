<template>
  <Dialog
    :visible="visible"
    modal
    header="Export Design Summary"
    :style="{ width: 'min(980px, calc(100vw - 32px))' }"
    :closable="!loading"
    :draggable="false"
    class="design-report-export-dialog"
    @update:visible="handleVisibilityChange"
  >
    <div class="design-report-export-content">
      <!-- Top format tabs -->
      <div class="format-tabs-bar">
        <div class="format-tabs" role="tablist" aria-label="Export Format">
          <button
            v-for="fmt in formats"
            :key="fmt.id"
            type="button"
            role="tab"
            :aria-selected="selectedFormat === fmt.id"
            class="format-tab-btn"
            :class="{ active: selectedFormat === fmt.id }"
            @click="emit('update:selectedFormat', fmt.id)"
          >
            <i :class="fmt.icon" aria-hidden="true" />
            <span class="tab-label">{{ fmt.label }}</span>
            <span class="tab-badge">{{ fmt.ext }}</span>
          </button>
        </div>

        <div class="export-actions-quick">
          <button
            type="button"
            class="quick-action-btn"
            title="Copy current format to clipboard"
            :disabled="loading || Boolean(error) || !content"
            @click="emit('copy')"
          >
            <i class="ri-file-copy-line" aria-hidden="true" />
            <span>Copy</span>
          </button>
          <button
            type="button"
            class="quick-action-btn"
            title="Refresh workspace metrics"
            :disabled="loading"
            @click="emit('refresh')"
          >
            <i
              class="ri-refresh-line"
              :class="{ 'animate-spin': loading }"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <!-- Config options bar -->
      <div class="options-bar">
        <label class="option-checkbox">
          <input
            type="checkbox"
            :checked="options.includeMultiCorner"
            @change="
              updateOption(
                'includeMultiCorner',
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          <span>Multi-Corner Timing</span>
        </label>
        <label class="option-checkbox">
          <input
            type="checkbox"
            :checked="options.includeStageBreakdown"
            @change="
              updateOption(
                'includeStageBreakdown',
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          <span>Stage Execution Breakdown</span>
        </label>

        <label v-if="selectedFormat === 'latex'" class="option-checkbox">
          <input
            type="checkbox"
            :checked="options.latexStandalone"
            @change="
              updateOption('latexStandalone', ($event.target as HTMLInputElement).checked)
            "
          />
          <span>Standalone Document (IEEEtran)</span>
        </label>
      </div>

      <!-- Main Preview Area -->
      <div class="preview-container">
        <div v-if="loading" class="preview-loading" role="status">
          <i class="ri-loader-4-line animate-spin" aria-hidden="true" />
          <span>Extracting design metrics from workspace...</span>
        </div>

        <div v-else-if="error" class="preview-error" role="alert">
          <i class="ri-error-warning-line" aria-hidden="true" />
          <div class="error-details">
            <strong>Failed to generate design report</strong>
            <p>{{ error }}</p>
          </div>
          <button type="button" class="retry-btn" @click="emit('refresh')">Retry</button>
        </div>

        <div v-else-if="content" class="preview-code-wrap">
          <div class="preview-header-info">
            <span class="preview-lang-tag">{{ formatLabel(selectedFormat) }}</span>
            <span class="preview-size-tag"
              >{{ lineCount }} lines ({{ charCount }} bytes)</span
            >
          </div>
          <pre class="preview-code" tabindex="0"><code>{{ content }}</code></pre>
        </div>

        <div v-else class="preview-empty">
          <i class="ri-file-text-line" aria-hidden="true" />
          <span>No report data available for the current workspace.</span>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="design-report-export-footer">
        <div class="footer-actions">
          <button
            type="button"
            class="dialog-btn dialog-btn-secondary"
            @click="emit('close')"
          >
            Close
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn-secondary"
            :disabled="loading || Boolean(error) || !content"
            @click="emit('copy')"
          >
            <i class="ri-clipboard-line" aria-hidden="true" />
            Copy to Clipboard
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn-secondary"
            :disabled="loading || Boolean(error) || !content"
            @click="emit('saveAll')"
          >
            <i class="ri-folder-zip-line" aria-hidden="true" />
            Export All Formats (4 Files)
          </button>
          <button
            type="button"
            class="dialog-btn dialog-btn-primary"
            :disabled="loading || Boolean(error) || !content"
            @click="emit('saveCurrent')"
          >
            <i class="ri-download-2-line" aria-hidden="true" />
            Save .{{ formatExt(selectedFormat) }}
          </button>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  DesignReportData,
  DesignReportExportOptions,
  DesignReportFormat,
} from '@ecos-studio/shared'
import Dialog from 'primevue/dialog'

const props = defineProps<{
  content: string
  error: string
  loading: boolean
  options: DesignReportExportOptions
  reportData: DesignReportData | null
  selectedFormat: DesignReportFormat
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  copy: []
  refresh: []
  saveAll: []
  saveCurrent: []
  'update:options': [options: DesignReportExportOptions]
  'update:selectedFormat': [format: DesignReportFormat]
}>()

const formats: Array<{
  id: DesignReportFormat
  label: string
  ext: string
  icon: string
}> = [
  { id: 'latex', label: 'LaTeX Paper', ext: '.tex', icon: 'ri-brackets-line' },
  { id: 'markdown', label: 'Markdown Docs', ext: '.md', icon: 'ri-markdown-line' },
  { id: 'csv', label: 'CSV Table', ext: '.csv', icon: 'ri-table-line' },
  { id: 'text', label: 'Plain Text Log', ext: '.txt', icon: 'ri-file-text-line' },
]

const lineCount = computed(() => {
  if (!props.content) return 0
  return props.content.split('\n').length
})

const charCount = computed(() => {
  return props.content ? props.content.length : 0
})

function formatLabel(format: DesignReportFormat): string {
  switch (format) {
    case 'latex':
      return 'LaTeX (booktabs / siunitx)'
    case 'markdown':
      return 'GitHub Flavored Markdown'
    case 'csv':
      return 'RFC 4180 CSV Data'
    case 'text':
      return 'ASCII Table Log'
  }
}

function formatExt(format: DesignReportFormat): string {
  switch (format) {
    case 'latex':
      return 'tex'
    case 'markdown':
      return 'md'
    case 'csv':
      return 'csv'
    case 'text':
      return 'txt'
  }
}

function updateOption<K extends keyof DesignReportExportOptions>(
  key: K,
  value: DesignReportExportOptions[K],
): void {
  emit('update:options', {
    ...props.options,
    [key]: value,
  })
}

function handleVisibilityChange(nextVisible: boolean): void {
  if (!nextVisible) emit('close')
}
</script>

<style>
.design-report-export-dialog.p-dialog {
  background: var(--bg-primary) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 8px !important;
  color: var(--text-primary) !important;
}

.design-report-export-dialog .p-dialog-header,
.design-report-export-dialog .p-dialog-content,
.design-report-export-dialog .p-dialog-footer {
  background: transparent;
  color: var(--text-primary);
}

.design-report-export-dialog .p-dialog-header {
  padding: 18px 20px 10px;
}

.design-report-export-dialog .p-dialog-content {
  padding: 10px 20px;
}

.design-report-export-dialog .p-dialog-footer {
  padding: 12px 20px 18px;
}
</style>

<style scoped>
.design-report-export-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.format-tabs-bar {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  padding-bottom: 10px;
}

.format-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.format-tab-btn {
  align-items: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  font-size: 13px;
  gap: 6px;
  padding: 6px 12px;
  transition: all 0.15s ease;
}

.format-tab-btn:hover {
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-secondary));
  color: var(--text-primary);
}

.format-tab-btn.active {
  background: var(--accent-color);
  border-color: var(--accent-color);
  color: #ffffff;
  font-weight: 500;
}

.tab-badge {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  padding: 1px 5px;
}

.format-tab-btn.active .tab-badge {
  background: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

.export-actions-quick {
  display: flex;
  gap: 6px;
}

.quick-action-btn {
  align-items: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  gap: 5px;
  padding: 6px 10px;
}

.quick-action-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-secondary));
  color: var(--text-primary);
}

.quick-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.options-bar {
  align-items: center;
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 12px;
}

.option-checkbox {
  align-items: center;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  gap: 6px;
  user-select: none;
}

.option-checkbox:hover {
  color: var(--text-primary);
}

.option-checkbox input[type='checkbox'] {
  accent-color: var(--accent-color);
  cursor: pointer;
}

.preview-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  min-height: 380px;
  max-height: min(56vh, 520px);
  position: relative;
}

.preview-loading,
.preview-empty {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 380px;
  justify-content: center;
}

.preview-loading i,
.preview-empty i {
  font-size: 28px;
}

.preview-error {
  align-items: center;
  color: var(--danger-color);
  display: flex;
  gap: 14px;
  height: 380px;
  justify-content: center;
  padding: 24px;
}

.preview-error i {
  font-size: 32px;
}

.error-details strong {
  display: block;
  font-size: 14px;
  margin-bottom: 4px;
}

.error-details p {
  color: var(--text-secondary);
  font-size: 12px;
  margin: 0;
}

.retry-btn {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  padding: 6px 12px;
}

.preview-code-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.preview-header-info {
  align-items: center;
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  font-size: 11px;
  justify-content: space-between;
  padding: 6px 12px;
}

.preview-lang-tag {
  color: var(--accent-color);
  font-weight: 600;
}

.preview-size-tag {
  color: var(--text-secondary);
  font-family: monospace;
}

.preview-code {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  overflow: auto;
  padding: 12px 14px;
  white-space: pre;
}

.design-report-export-footer {
  align-items: center;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  padding-top: 12px;
  width: 100%;
}

.footer-meta {
  color: var(--text-secondary);
  font-size: 12px;
}

.footer-actions {
  display: flex;
  gap: 8px;
}

.dialog-btn {
  align-items: center;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  font-size: 13px;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  transition: all 0.15s ease;
}

.dialog-btn-secondary {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.dialog-btn-secondary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-secondary));
}

.dialog-btn-primary {
  background: var(--accent-color);
  border: 1px solid var(--accent-color);
  color: #ffffff;
  font-weight: 500;
}

.dialog-btn-primary:hover:not(:disabled) {
  opacity: 0.92;
}

.dialog-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

@media (max-width: 760px) {
  .format-tabs-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .options-bar {
    flex-direction: column;
    align-items: flex-start;
  }
  .design-report-export-footer {
    flex-direction: column;
    gap: 10px;
    align-items: flex-end;
  }
  .footer-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
