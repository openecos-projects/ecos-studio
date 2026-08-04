<template>
  <div class="report-content-preview" :class="{ compact }">
    <div v-if="format === 'json' && simpleJson" class="report-preview-scroll">
      <table>
        <tbody>
          <tr v-for="(value, key) in simpleJson" :key="key">
            <th>{{ key }}</th>
            <td>{{ formatValue(value) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <pre
      v-else-if="format === 'json'"
      class="report-preview-scroll report-preview-code"
    ><code>{{ formattedJson }}</code></pre>

    <div v-else-if="format === 'csv'" class="report-preview-scroll">
      <table>
        <thead v-if="csvHeaders.length">
          <tr>
            <th v-for="header in csvHeaders" :key="header">{{ header }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in csvRows" :key="index">
            <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-else-if="format === 'html'"
      class="report-preview-scroll report-preview-html"
      v-html="safeHtml"
    />

    <pre
      v-else
      class="report-preview-scroll report-preview-code"
    ><code>{{ content || 'Report content is unavailable.' }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeHtml } from '@/utils/sanitizeHtml'

const props = withDefaults(
  defineProps<{
    compact?: boolean
    content: string
    path: string
  }>(),
  { compact: true },
)

type ReportFormat = 'csv' | 'html' | 'json' | 'text'

const format = computed<ReportFormat>(() => {
  const extension = props.path.split('.').pop()?.toLowerCase()
  if (extension === 'json') return 'json'
  if (extension === 'csv') return 'csv'
  if (extension === 'html' || extension === 'htm') return 'html'
  return 'text'
})

const parsedJson = computed<unknown | null>(() => {
  if (format.value !== 'json' || !props.content) return null
  try {
    return JSON.parse(props.content)
  } catch {
    return null
  }
})

const simpleJson = computed<Record<string, unknown> | null>(() => {
  const value = parsedJson.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const object = value as Record<string, unknown>
  return Object.values(object).every((item) => typeof item !== 'object' || item === null)
    ? object
    : null
})

const formattedJson = computed(() => {
  if (parsedJson.value === null) return props.content || 'Report content is unavailable.'
  try {
    return JSON.stringify(parsedJson.value, null, 2)
  } catch {
    return props.content
  }
})

const csvHeaders = computed(() => csvLines.value[0] ?? [])
const csvRows = computed(() => csvLines.value.slice(1))
const csvLines = computed(() =>
  format.value === 'csv' && props.content.trim()
    ? props.content
        .trim()
        .split('\n')
        .map((line) => line.split(',').map((cell) => cell.trim()))
    : [],
)
const safeHtml = computed(() => sanitizeHtml(props.content))

function formatValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number') {
    return Math.abs(value) < 0.001 || Math.abs(value) > 10000
      ? value.toExponential(3)
      : value.toLocaleString()
  }
  return String(value)
}
</script>

<style scoped>
.report-content-preview {
  color: var(--text-primary);
  min-width: 0;
  user-select: text;
}

.report-preview-scroll {
  max-height: min(48vh, 520px);
  overflow: auto;
}

.compact .report-preview-scroll {
  max-height: 170px;
}

table {
  border-collapse: collapse;
  font-size: 10px;
  min-width: 100%;
}

th,
td {
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}

thead th,
tbody th {
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-weight: 600;
}

thead th {
  position: sticky;
  top: 0;
}

tbody th {
  width: 40%;
}

td {
  overflow-wrap: anywhere;
}

.report-preview-code {
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  line-height: 1.45;
  margin: 0;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}

.report-preview-html {
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  font-size: 10px;
  line-height: 1.45;
  padding: 8px;
}

.report-preview-html :deep(h1),
.report-preview-html :deep(h2),
.report-preview-html :deep(h3) {
  color: var(--text-primary);
  margin: 0 0 7px;
}

.report-preview-html :deep(h1) {
  font-size: 1.3em;
}

.report-preview-html :deep(h2) {
  font-size: 1.15em;
}

.report-preview-html :deep(h3) {
  font-size: 1.05em;
}

.report-preview-html :deep(p) {
  margin: 0 0 6px;
}

.report-preview-html :deep(pre) {
  overflow: auto;
  white-space: pre-wrap;
}

.report-preview-html :deep(a) {
  color: var(--accent-color);
}
</style>
