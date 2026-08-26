<script setup lang="ts">
/**
 * Non-tree UI: sub-cards / tables / rows; nested blocks use sc-pro-subpanel to avoid infinite tree indent.
 */
import { computed, ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Checkbox from 'primevue/checkbox'
import Textarea from 'primevue/textarea'
import StepConfigValueBlock from './StepConfigValueBlock.vue'
import { useStepConfigDiff } from './stepConfigDiff'

const model = defineModel<unknown>({ required: true })

const props = withDefaults(
  defineProps<{
    depth?: number
    maxDepth?: number
    accent?: 'indigo' | 'violet' | 'emerald' | 'amber' | 'cyan'
    readonly?: boolean
    /** Baseline-comparison leaf path ('' at the root; keys append '.k', array items '[i]'). */
    path?: string
  }>(),
  { depth: 0, maxDepth: 5, accent: 'indigo', readonly: false, path: '' },
)

const diff = useStepConfigDiff()

function childPath(key: string): string {
  return props.path ? `${props.path}.${key}` : key
}

function itemPath(index: number): string {
  return `${props.path}[${index}]`
}

function cellPath(rowIndex: number, key: string): string {
  return `${itemPath(rowIndex)}.${key}`
}

function isChanged(path: string): boolean {
  return diff?.isChanged(path) ?? false
}

function changedUnder(prefix: string): number {
  return diff?.changedCountUnder(prefix) ?? 0
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const uniformTable = computed(() => {
  const v = model.value
  if (!Array.isArray(v) || v.length === 0) return null
  const first = v[0]
  if (!isObj(first)) return null
  const keys = Object.keys(first)
  if (!keys.length) return null
  if (!v.every((row) => isObj(row) && keys.every((k) => k in row))) return null
  return { keys, rows: v as Record<string, unknown>[] }
})

const objectKeys = computed(() => {
  const v = model.value
  if (!isObj(v)) return []
  return Object.keys(v).sort((a, b) => a.localeCompare(b))
})

function setKey(k: string, val: unknown): void {
  if (props.readonly) return
  if (!isObj(model.value)) return
  ;(model.value as Record<string, unknown>)[k] = val
}

function setCell(ri: number, k: string, val: unknown): void {
  if (props.readonly) return
  const m = model.value
  if (!Array.isArray(m) || !isObj(m[ri])) return
  ;(m[ri] as Record<string, unknown>)[k] = val
}

function removeAt(i: number): void {
  if (props.readonly) return
  const m = model.value
  if (!Array.isArray(m)) return
  m.splice(i, 1)
}

function addPrimitive(): void {
  if (props.readonly) return
  const m = model.value
  if (!Array.isArray(m)) return
  m.push('')
}

function addRow(keys: string[]): void {
  if (props.readonly) return
  const m = model.value
  if (!Array.isArray(m)) return
  const row: Record<string, unknown> = {}
  for (const k of keys) row[k] = ''
  m.push(row)
}

function setScalar(v: unknown): void {
  if (props.readonly) return
  model.value = v
}

function formatFallback(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

const jsonEdit = ref(formatFallback(model.value))

watch(
  () => model.value,
  (v) => {
    jsonEdit.value = formatFallback(v)
  },
  { deep: true },
)

function applyJsonEdit(): void {
  if (props.readonly) return
  try {
    model.value = JSON.parse(jsonEdit.value)
  } catch {
    /* Keep editor text on invalid JSON */
  }
}

function setPrim(i: number, v: unknown): void {
  if (props.readonly) return
  const m = model.value
  if (!Array.isArray(m)) return
  m[i] = v
}
</script>

<template>
  <div class="sc-pro-value" :data-depth="depth">
    <!-- Scalar -->
    <div
      v-if="model === null || model === undefined || typeof model !== 'object'"
      class="sc-field w-full min-w-0"
      :class="{ 'sc-diff': isChanged(path) }"
    >
      <InputText
        v-if="typeof model === 'string'"
        :model-value="model"
        size="small"
        fluid
        class="w-full min-w-0"
        @update:model-value="setScalar($event)"
      />
      <InputNumber
        v-else-if="typeof model === 'number'"
        :model-value="model"
        size="small"
        fluid
        class="w-full min-w-0"
        :use-grouping="false"
        @update:model-value="setScalar($event ?? 0)"
      />
      <div v-else-if="typeof model === 'boolean'" class="flex items-center gap-2">
        <Checkbox :model-value="model" binary @update:model-value="setScalar($event)" />
        <span class="text-[11px] text-(--text-secondary)">{{
          model ? 'true' : 'false'
        }}</span>
      </div>
      <InputText
        v-else
        :model-value="String(model)"
        size="small"
        fluid
        class="w-full min-w-0"
        readonly
      />
    </div>

    <!-- Max depth exceeded: JSON -->
    <div
      v-else-if="depth >= maxDepth"
      class="field"
      :class="{ 'sc-diff': changedUnder(path) > 0 }"
    >
      <label>JSON</label>
      <Textarea
        v-model="jsonEdit"
        auto-resize
        rows="6"
        fluid
        class="w-full min-w-0 font-mono text-[11px]"
        :readonly="readonly"
        @blur="applyJsonEdit"
      />
    </div>

    <!-- Uniform table -->
    <div v-else-if="uniformTable" class="sc-pro-table-wrap">
      <table class="sc-pro-table sc-pro-table--uniform">
        <thead>
          <tr>
            <th v-for="k in uniformTable.keys" :key="k">{{ k }}</th>
            <th v-if="!readonly" class="w-10"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in uniformTable.rows" :key="ri">
            <td
              v-for="k in uniformTable.keys"
              :key="k"
              class="align-top"
              :class="{ 'sc-diff': isChanged(cellPath(ri, k)) }"
            >
              <StepConfigValueBlock
                v-if="isObj(row[k]) || Array.isArray(row[k])"
                :model-value="row[k]"
                :depth="depth + 1"
                :max-depth="maxDepth"
                :accent="accent"
                :readonly="readonly"
                :path="cellPath(ri, k)"
                @update:model-value="setCell(ri, k, $event)"
              />
              <InputText
                v-else-if="typeof row[k] === 'string'"
                :model-value="row[k] as string"
                size="small"
                fluid
                class="w-full min-w-0"
                @update:model-value="setCell(ri, k, $event)"
              />
              <InputNumber
                v-else-if="typeof row[k] === 'number'"
                :model-value="row[k] as number"
                size="small"
                fluid
                class="w-full min-w-0"
                :use-grouping="false"
                @update:model-value="setCell(ri, k, $event ?? 0)"
              />
              <Checkbox
                v-else-if="typeof row[k] === 'boolean'"
                :model-value="row[k] as boolean"
                binary
                @update:model-value="setCell(ri, k, $event)"
              />
              <InputText
                v-else
                :model-value="formatFallback(row[k])"
                size="small"
                fluid
                class="w-full min-w-0"
                readonly
              />
            </td>
            <td v-if="!readonly">
              <button
                type="button"
                class="sc-pro-btn sc-pro-btn--danger"
                title="Remove row"
                @click="removeAt(ri)"
              >
                <i class="ri-delete-bin-line"></i>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="!readonly"
        class="border-t border-(--border-color) bg-(--bg-secondary)/40 px-2 py-2"
      >
        <button type="button" class="sc-pro-btn" @click="addRow(uniformTable.keys)">
          <i class="ri-add-line"></i>
          Add row
        </button>
      </div>
    </div>

    <!-- Primitive array: input must shrink (fluid) or delete button is clipped in narrow panels -->
    <div v-else-if="Array.isArray(model)" class="min-w-0 space-y-1">
      <div
        v-for="(_x, i) in model as unknown[]"
        :key="i"
        class="flex w-full min-w-0 items-center gap-2"
        :class="{ 'sc-diff': isChanged(itemPath(i)) }"
      >
        <InputText
          v-if="typeof (model as unknown[])[i] === 'string'"
          :model-value="(model as string[])[i]"
          size="small"
          fluid
          class="min-w-0 flex-1"
          @update:model-value="setPrim(i, $event)"
        />
        <InputNumber
          v-else-if="typeof (model as unknown[])[i] === 'number'"
          :model-value="(model as number[])[i]"
          size="small"
          fluid
          class="min-w-0 flex-1"
          :use-grouping="false"
          @update:model-value="setPrim(i, $event ?? 0)"
        />
        <div
          v-else-if="
            isObj((model as unknown[])[i]) || Array.isArray((model as unknown[])[i])
          "
          class="min-w-0 flex-1"
        >
          <StepConfigValueBlock
            :model-value="(model as unknown[])[i]"
            :depth="depth + 1"
            :max-depth="maxDepth"
            :accent="accent"
            :readonly="readonly"
            :path="itemPath(i)"
            @update:model-value="setPrim(i, $event)"
          />
        </div>
        <InputText
          v-else
          :model-value="formatFallback((model as unknown[])[i])"
          size="small"
          fluid
          class="min-w-0 flex-1"
          readonly
        />
        <button
          v-if="!readonly"
          type="button"
          class="sc-pro-btn sc-pro-btn--danger shrink-0"
          title="Remove"
          @click="removeAt(i)"
        >
          <i class="ri-close-line"></i>
        </button>
      </div>
      <button v-if="!readonly" type="button" class="sc-pro-btn" @click="addPrimitive">
        <i class="ri-add-line"></i>
        Add item
      </button>
    </div>

    <!-- Object → sub-panels -->
    <div v-else class="space-y-2">
      <div
        v-for="k in objectKeys"
        :key="k"
        class="sc-pro-subpanel"
        :class="{ 'sc-diff-panel': changedUnder(childPath(k)) > 0 }"
      >
        <div class="sc-pro-subpanel__title">
          {{ k }}
          <span
            v-if="changedUnder(childPath(k)) > 0"
            class="sc-diff-badge"
            title="Changed vs baseline"
            >{{ changedUnder(childPath(k)) }}</span
          >
        </div>
        <StepConfigValueBlock
          :model-value="(model as Record<string, unknown>)[k]"
          :depth="depth + 1"
          :max-depth="maxDepth"
          :accent="accent"
          :readonly="readonly"
          :path="childPath(k)"
          @update:model-value="setKey(k, $event)"
        />
      </div>
    </div>
  </div>
</template>
