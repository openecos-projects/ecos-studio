<template>
  <section class="mpc-template-preview" aria-label="MPC core template">
    <div class="mpc-template-preview__heading">
      <div>
        <p class="mpc-template-preview__eyebrow">Selected design</p>
        <h3>{{ designName }}</h3>
      </div>
      <p v-if="directory" class="mpc-template-preview__directory">{{ directory }}</p>
    </div>

    <div class="mpc-template-preview__grid">
      <section v-if="hasEntries(preview.template)" class="mpc-template-section">
        <h4>Template</h4>
        <dl class="mpc-template-details">
          <template v-for="[key, value] in objectEntries(preview.template)" :key="key">
            <dt>{{ labelFor(key) }}</dt>
            <dd>{{ formatValue(value) }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="hasEntries(preview.limits)" class="mpc-template-section">
        <h4>Design Limits</h4>
        <dl class="mpc-template-details">
          <template v-for="[key, value] in objectEntries(preview.limits)" :key="key">
            <dt>{{ labelFor(key) }}</dt>
            <dd>{{ formatValue(value) }}</dd>
          </template>
        </dl>
      </section>

      <section
        v-if="preview.parameters.length"
        class="mpc-template-section mpc-template-section--wide"
      >
        <h4>Parameters</h4>
        <div class="mpc-template-table-wrap">
          <table class="mpc-template-table">
            <thead>
              <tr>
                <th v-for="column in parameterColumns" :key="column">
                  {{ labelFor(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(parameter, index) in preview.parameters"
                :key="parameterKey(parameter, index)"
              >
                <td v-for="column in parameterColumns" :key="column">
                  {{ formatValue(parameter[column]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section
        v-if="preview.ports.length"
        class="mpc-template-section mpc-template-section--wide"
      >
        <h4>Ports</h4>
        <div class="mpc-template-table-wrap">
          <table class="mpc-template-table">
            <thead>
              <tr>
                <th v-for="column in portColumns" :key="column">
                  {{ labelFor(column) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(port, index) in preview.ports" :key="parameterKey(port, index)">
                <td v-for="column in portColumns" :key="column">
                  {{ formatValue(port[column]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="hasEntries(preview.frameIo)" class="mpc-template-section">
        <h4>Frame I/O</h4>
        <dl class="mpc-template-details">
          <template v-for="[key, value] in objectEntries(preview.frameIo)" :key="key">
            <dt>{{ labelFor(key) }}</dt>
            <dd>{{ formatValue(value) }}</dd>
          </template>
        </dl>
      </section>

      <section v-if="hasEntries(preview.templateBehavior)" class="mpc-template-section">
        <h4>Template Behavior</h4>
        <dl class="mpc-template-details">
          <template
            v-for="[key, value] in objectEntries(preview.templateBehavior)"
            :key="key"
          >
            <dt>{{ labelFor(key) }}</dt>
            <dd>{{ formatValue(value) }}</dd>
          </template>
        </dl>
      </section>

      <section
        v-if="hasEntries(preview.other)"
        class="mpc-template-section mpc-template-section--wide"
      >
        <h4>Other Constraints</h4>
        <dl class="mpc-template-details">
          <template v-for="[key, value] in objectEntries(preview.other)" :key="key">
            <dt>{{ labelFor(key) }}</dt>
            <dd>{{ formatValue(value) }}</dd>
          </template>
        </dl>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { previewMpcCoreTemplate } from '@/utils/mpcSpec'

const props = defineProps<{
  coreTemplate: Record<string, unknown>
  designName: string
  directory?: string
}>()

const preview = computed(() => previewMpcCoreTemplate(props.coreTemplate))
const parameterColumns = computed(() => columnsFor(preview.value.parameters))
const portColumns = computed(() => columnsFor(preview.value.ports))

function hasEntries(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0
}

function objectEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value)
}

function columnsFor(rows: Record<string, unknown>[]): string[] {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
}

function parameterKey(value: Record<string, unknown>, index: number): string {
  const name = value.name
  return typeof name === 'string' && name ? name : String(index)
}

function labelFor(key: string): string {
  return key.replace(/_/g, ' ')
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-'
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }
  return JSON.stringify(value)
}
</script>

<style scoped>
.mpc-template-preview {
  display: grid;
  gap: 12px;
  margin-top: 12px;
}

.mpc-template-preview__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mpc-template-preview__heading h3,
.mpc-template-section h4,
.mpc-template-preview__eyebrow,
.mpc-template-preview__directory,
.mpc-template-details {
  margin: 0;
}

.mpc-template-preview__heading h3 {
  font-size: 14px;
}

.mpc-template-preview__eyebrow {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.mpc-template-preview__directory {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  text-align: right;
}

.mpc-template-preview__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mpc-template-section {
  min-width: 0;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--border-color) 84%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
}

.mpc-template-section--wide {
  grid-column: 1 / -1;
}

.mpc-template-section h4 {
  margin-bottom: 8px;
  font-size: 12px;
}

.mpc-template-details {
  display: grid;
  grid-template-columns: minmax(88px, 0.38fr) minmax(0, 1fr);
  gap: 5px 10px;
  font-size: 11px;
}

.mpc-template-details dt {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.mpc-template-details dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.mpc-template-table {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  font-size: 11px;
}

.mpc-template-table-wrap {
  overflow-x: auto;
}

.mpc-template-table th,
.mpc-template-table td {
  padding: 6px 7px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  overflow-wrap: anywhere;
  text-align: left;
  vertical-align: top;
}

.mpc-template-table th {
  color: var(--text-secondary);
  font-weight: 700;
}

@media (max-width: 640px) {
  .mpc-template-preview__heading,
  .mpc-template-preview__grid {
    display: grid;
    grid-template-columns: 1fr;
  }

  .mpc-template-preview__directory {
    text-align: left;
  }
}
</style>
