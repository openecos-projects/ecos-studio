<template>
  <section class="mpc-preview" aria-label="MPC template resources">
    <header class="mpc-preview__heading">
      <div>
        <p class="mpc-preview__eyebrow">Selected design</p>
        <h3>{{ design.designName }}</h3>
      </div>
      <p v-if="design.directory" class="mpc-preview__directory">
        {{ design.directory }}
      </p>
    </header>

    <section class="mpc-preview__band" aria-labelledby="mpc-resources-heading">
      <div class="mpc-preview__band-heading">
        <p class="mpc-preview__eyebrow">MPC Resources</p>
        <h4 id="mpc-resources-heading">Top-level design resources</h4>
      </div>

      <div class="mpc-preview__grid mpc-preview__grid--resources">
        <section class="mpc-preview-section">
          <h5>Design</h5>
          <dl class="mpc-preview-details">
            <dt>Name</dt>
            <dd>{{ design.designName }}</dd>
            <dt>Directory</dt>
            <dd>{{ formatValue(design.directory) }}</dd>
            <dt>DBU</dt>
            <dd>{{ formatValue(design.dbu) }}</dd>
            <dt>I/O pins</dt>
            <dd>{{ pinCount }}</dd>
          </dl>
        </section>

        <section class="mpc-preview-section mpc-preview-section--geometry">
          <h5>Die Geometry</h5>
          <dl class="mpc-preview-details">
            <template v-for="[key, value] in geometryEntries(design.die)" :key="key">
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section class="mpc-preview-section mpc-preview-section--geometry">
          <h5>Core Geometry</h5>
          <dl class="mpc-preview-details">
            <template v-for="[key, value] in geometryEntries(design.core)" :key="key">
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="hasEntries(design.other)" class="mpc-preview-section">
          <h5>Other Resources</h5>
          <dl class="mpc-preview-details">
            <template v-for="[key, value] in objectEntries(design.other)" :key="key">
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="hasEntries(design.ioPins.other)" class="mpc-preview-section">
          <h5>I/O Metadata</h5>
          <dl class="mpc-preview-details">
            <template
              v-for="[key, value] in objectEntries(design.ioPins.other)"
              :key="key"
            >
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section
          v-if="design.ioPins.list.length"
          class="mpc-preview-section mpc-preview-section--wide"
        >
          <div class="mpc-preview-section__heading">
            <h5>I/O Pins</h5>
            <span>{{ pinCount }}</span>
          </div>
          <div class="mpc-preview-table-wrap mpc-preview-table-wrap--pins">
            <table class="mpc-preview-table">
              <thead>
                <tr>
                  <th v-for="column in pinColumns" :key="column">
                    {{ labelFor(column) }}
                  </th>
                  <th v-if="hasPinBoundingBoxes">Bounding Box</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(pin, index) in design.ioPins.list" :key="rowKey(pin, index)">
                  <td v-for="column in pinColumns" :key="column">
                    {{ formatValue(pin[column]) }}
                  </td>
                  <td v-if="hasPinBoundingBoxes">
                    {{ formatBoundingBox(pin.bounding_box) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>

    <section class="mpc-preview__band" aria-labelledby="core-template-heading">
      <div class="mpc-preview__band-heading">
        <p class="mpc-preview__eyebrow">Core Template</p>
        <h4 id="core-template-heading">Constraints and interface</h4>
      </div>

      <div class="mpc-preview__grid">
        <section v-if="hasEntries(templatePreview.template)" class="mpc-preview-section">
          <h5>Template</h5>
          <dl class="mpc-preview-details">
            <template
              v-for="[key, value] in objectEntries(templatePreview.template)"
              :key="key"
            >
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="hasEntries(templatePreview.limits)" class="mpc-preview-section">
          <h5>Design Limits</h5>
          <dl class="mpc-preview-details">
            <template
              v-for="[key, value] in objectEntries(templatePreview.limits)"
              :key="key"
            >
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section
          v-if="templatePreview.parameters.length"
          class="mpc-preview-section mpc-preview-section--wide"
        >
          <h5>Parameters</h5>
          <div class="mpc-preview-table-wrap">
            <table class="mpc-preview-table">
              <thead>
                <tr>
                  <th v-for="column in parameterColumns" :key="column">
                    {{ labelFor(column) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(parameter, index) in templatePreview.parameters"
                  :key="rowKey(parameter, index)"
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
          v-if="templatePreview.ports.length"
          class="mpc-preview-section mpc-preview-section--wide"
        >
          <h5>Ports</h5>
          <div class="mpc-preview-table-wrap">
            <table class="mpc-preview-table">
              <thead>
                <tr>
                  <th v-for="column in portColumns" :key="column">
                    {{ labelFor(column) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(port, index) in templatePreview.ports"
                  :key="rowKey(port, index)"
                >
                  <td v-for="column in portColumns" :key="column">
                    {{ formatValue(port[column]) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="hasEntries(templatePreview.frameIo)" class="mpc-preview-section">
          <h5>Frame I/O</h5>
          <dl class="mpc-preview-details">
            <template
              v-for="[key, value] in objectEntries(templatePreview.frameIo)"
              :key="key"
            >
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section
          v-if="hasEntries(templatePreview.templateBehavior)"
          class="mpc-preview-section"
        >
          <h5>Template Behavior</h5>
          <dl class="mpc-preview-details">
            <template
              v-for="[key, value] in objectEntries(templatePreview.templateBehavior)"
              :key="key"
            >
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>

        <section
          v-if="hasEntries(templatePreview.other)"
          class="mpc-preview-section mpc-preview-section--wide"
        >
          <h5>Other Constraints</h5>
          <dl class="mpc-preview-details">
            <template
              v-for="[key, value] in objectEntries(templatePreview.other)"
              :key="key"
            >
              <dt>{{ labelFor(key) }}</dt>
              <dd>{{ formatValue(value) }}</dd>
            </template>
          </dl>
        </section>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { previewMpcCoreTemplate, type MpcSpecDesign } from '@/utils/mpcSpec'

const props = defineProps<{
  design: MpcSpecDesign
}>()

const templatePreview = computed(() => previewMpcCoreTemplate(props.design.coreTemplate))
const parameterColumns = computed(() => columnsFor(templatePreview.value.parameters))
const portColumns = computed(() => columnsFor(templatePreview.value.ports))
const pinColumns = computed(() =>
  columnsFor(props.design.ioPins.list, ['name', 'info'], new Set(['bounding_box'])),
)
const hasPinBoundingBoxes = computed(() =>
  props.design.ioPins.list.some((pin) => 'bounding_box' in pin),
)
const pinCount = computed(
  () => props.design.ioPins.declaredCount ?? props.design.ioPins.list.length,
)

function hasEntries(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0
}

function objectEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(value)
}

function geometryEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  const fields = ['llx', 'lly', 'urx', 'ury', 'width', 'height', 'area']
  const extraFields = Object.keys(value).filter((field) => !fields.includes(field))
  const entries = [...fields, ...extraFields].map(
    (field) => [field, value[field]] as [string, unknown],
  )
  return entries.some(([, fieldValue]) => fieldValue !== undefined)
    ? entries
    : [['status', null]]
}

function columnsFor(
  rows: Record<string, unknown>[],
  preferred: string[] = [],
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  const available = new Set(rows.flatMap((row) => Object.keys(row)))
  return [
    ...preferred.filter((column) => available.has(column) && !excluded.has(column)),
    ...Array.from(available).filter(
      (column) => !preferred.includes(column) && !excluded.has(column),
    ),
  ]
}

function rowKey(value: Record<string, unknown>, index: number): string {
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

function formatBoundingBox(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return formatValue(value)
  }
  const entries = geometryEntries(value as Record<string, unknown>)
  if (
    entries.every(([, fieldValue]) => fieldValue === undefined || fieldValue === null)
  ) {
    return '-'
  }
  return entries
    .filter(([, fieldValue]) => fieldValue !== undefined)
    .map(([key, fieldValue]) => `${labelFor(key)}: ${formatValue(fieldValue)}`)
    .join(', ')
}
</script>

<style scoped>
.mpc-preview {
  display: grid;
  gap: 16px;
  margin-top: 12px;
}

.mpc-preview__heading,
.mpc-preview-section__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.mpc-preview__heading h3,
.mpc-preview__band-heading h4,
.mpc-preview-section h5,
.mpc-preview__eyebrow,
.mpc-preview__directory,
.mpc-preview-details,
.mpc-preview-section__heading span {
  margin: 0;
}

.mpc-preview__heading h3 {
  font-size: 15px;
}

.mpc-preview__eyebrow {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.mpc-preview__directory {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  text-align: right;
}

.mpc-preview__band {
  min-width: 0;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
}

.mpc-preview__band-heading {
  margin-bottom: 10px;
}

.mpc-preview__band-heading h4 {
  margin-top: 2px;
  font-size: 13px;
}

.mpc-preview__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}

.mpc-preview-section {
  min-width: 0;
  padding: 10px 0;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
}

.mpc-preview-section--wide {
  grid-column: 1 / -1;
}

.mpc-preview__grid--resources .mpc-preview-section--geometry {
  grid-column: 2;
}

.mpc-preview-section h5 {
  margin-bottom: 8px;
  font-size: 12px;
}

.mpc-preview-section__heading span {
  color: var(--text-secondary);
  font-size: 11px;
}

.mpc-preview-details {
  display: grid;
  grid-template-columns: minmax(88px, 0.38fr) minmax(0, 1fr);
  gap: 5px 10px;
  font-size: 11px;
}

.mpc-preview-details dt {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.mpc-preview-details dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.mpc-preview-table-wrap {
  overflow-x: auto;
}

.mpc-preview-table-wrap--pins {
  max-height: 240px;
  overflow-y: auto;
}

.mpc-preview-table {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  font-size: 11px;
}

.mpc-preview-table th,
.mpc-preview-table td {
  max-width: 360px;
  padding: 7px 8px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  overflow-wrap: anywhere;
  text-align: left;
  vertical-align: top;
}

.mpc-preview-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-weight: 700;
}

@media (max-width: 640px) {
  .mpc-preview__heading,
  .mpc-preview__grid {
    display: grid;
    grid-template-columns: 1fr;
  }

  .mpc-preview__directory {
    text-align: left;
  }

  .mpc-preview-section--wide {
    grid-column: auto;
  }

  .mpc-preview__grid--resources .mpc-preview-section--geometry {
    grid-column: auto;
  }
}
</style>
