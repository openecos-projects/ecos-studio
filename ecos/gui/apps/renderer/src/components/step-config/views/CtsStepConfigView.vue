<script setup lang="ts">
import { computed } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'

const draft = defineModel<Record<string, unknown>>({ required: true })

const onOffOptions = [
  { label: 'OFF', value: 'OFF' },
  { label: 'ON', value: 'ON' },
]

function isOnOffVal(v: unknown): boolean {
  return v === 'OFF' || v === 'ON'
}

const allKeys = computed(() => Object.keys(draft.value).sort((a, b) => a.localeCompare(b)))

const groups = computed(() => {
  const keys = allKeys.value
  const g: { id: string; title: string; desc: string; keys: string[] }[] = [
    {
      id: 'algo',
      title: 'Algorithm & topology',
      desc: 'Clock-tree algorithm, delay, and clustering',
      keys: [],
    },
    {
      id: 'elec',
      title: 'Electrical & geometry',
      desc: 'Transition, capacitance, fanout, and wire length limits',
      keys: [],
    },
    {
      id: 'buf',
      title: 'Buffers & routing layers',
      desc: 'Buffer cell list and routing metal layers',
      keys: [],
    },
    {
      id: 'level',
      title: 'Level parameters',
      desc: 'level_* arrays: constraints per level',
      keys: [],
    },
    {
      id: 'lat',
      title: 'Latency tuning',
      desc: 'Level shift and latency ratios',
      keys: [],
    },
    {
      id: 'net',
      title: 'Netlists & external models',
      desc: 'Optional netlists and external delay models',
      keys: [],
    },
    {
      id: 'rest',
      title: 'Other',
      desc: 'Unclassified keys',
      keys: [],
    },
  ]
  const pick = (pred: (k: string) => boolean) => keys.filter(pred)

  g[0].keys = pick(
    (k) =>
      ['use_skew_tree_alg', 'router_type', 'delay_type', 'cluster_type', 'skew_bound'].includes(k) ||
      k === 'scale_size' ||
      k === 'cluster_size',
  )
  g[1].keys = pick((k) =>
    [
      'max_buf_tran',
      'max_sink_tran',
      'max_cap',
      'max_fanout',
      'min_length',
      'max_length',
    ].includes(k),
  )
  g[2].keys = pick((k) => k === 'routing_layer' || k.startsWith('buffer') || k === 'root_buffer_type')
  g[3].keys = pick((k) => k.startsWith('level_'))
  g[4].keys = pick((k) =>
    ['shift_level', 'latency_opt_level', 'global_latency_opt_ratio', 'local_latency_opt_ratio'].includes(k),
  )
  g[5].keys = pick((k) => k.includes('netlist') || k.includes('net_list') || k === 'external_model')

  const used = new Set<string>()
  for (const gr of g) gr.keys.forEach((k) => used.add(k))
  g[6].keys = keys.filter((k) => !used.has(k))

  return g.filter((gr) => gr.keys.length > 0)
})

function setKey(k: string, v: unknown): void {
  draft.value[k] = v
}
</script>

<template>
  <div class="sc-pro sc-cards" data-accent="violet">
    <section v-for="gr in groups" :key="gr.id" class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">{{ gr.title }}</div>
          <div class="sc-pro-section__desc">{{ gr.desc }}</div>
        </div>
      </div>
      <div class="sc-pro-section__body space-y-3">
        <template v-for="k in gr.keys" :key="k">
          <!-- OFF/ON -->
          <div v-if="isOnOffVal(draft[k])" class="field">
            <label>{{ k }}</label>
            <Select
              :model-value="draft[k] as string"
              :options="onOffOptions"
              option-label="label"
              option-value="value"
              size="small"
              fluid
              class="min-w-0"
              @update:model-value="setKey(k, $event)" />
          </div>
          <!-- Number -->
          <div v-else-if="typeof draft[k] === 'number'" class="field">
            <label>{{ k }}</label>
            <InputNumber
              v-model="(draft as Record<string, number>)[k]"
              size="small"
              fluid
              :use-grouping="false"
              class="min-w-0" />
          </div>
          <!-- String scalar -->
          <div v-else-if="typeof draft[k] === 'string'" class="field">
            <label>{{ k }}</label>
            <InputText
              v-model="(draft as Record<string, string>)[k]"
              size="small"
              fluid
              class="w-full min-w-0 font-mono text-[11px]" />
          </div>
          <!-- Number arrays: routing_layer / level_max_fanout, etc. -->
          <div v-else-if="Array.isArray(draft[k]) && (draft[k] as unknown[]).every((x) => typeof x === 'number')" class="field">
            <label>{{ k }}</label>
            <div class="space-y-2 w-full min-w-0">
              <div
                v-for="(_x, i) in (draft[k] as number[])"
                :key="i"
                class="flex items-center gap-2 w-full min-w-0 rounded border border-(--border-color) bg-(--bg-primary) px-2 py-1.5">
                <InputNumber
                  :model-value="(draft[k] as number[])[i]"
                  size="small"
                  fluid
                  :use-grouping="false"
                  class="min-w-0 w-full flex-1"
                  @update:model-value="((draft[k] as number[])[i] = $event ?? 0)" />
                <button
                  type="button"
                  class="sc-pro-btn sc-pro-btn--danger shrink-0"
                  title="Remove"
                  @click="(draft[k] as number[]).splice(i, 1)">
                  <i class="ri-close-line"></i>
                </button>
              </div>
              <button type="button" class="sc-pro-btn" @click="(draft[k] as number[]).push(0)">
                <i class="ri-add-line"></i>
                Add
              </button>
            </div>
          </div>
          <!-- String array -->
          <div v-else-if="Array.isArray(draft[k]) && (draft[k] as unknown[]).every((x) => typeof x === 'string')" class="field">
            <label>{{ k }}</label>
            <div class="space-y-1 w-full min-w-0">
              <div
                v-for="(_x, i) in (draft[k] as string[])"
                :key="i"
                class="flex w-full min-w-0 gap-2 items-center">
                <InputText
                  v-model="(draft[k] as string[])[i]"
                  size="small"
                  fluid
                  class="min-w-0 flex-1 font-mono text-[11px]" />
                <button
                  type="button"
                  class="sc-pro-btn sc-pro-btn--danger shrink-0"
                  @click="(draft[k] as string[]).splice(i, 1)">
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
              <button type="button" class="sc-pro-btn" @click="(draft[k] as string[]).push('')">
                <i class="ri-add-line"></i>
                Add
              </button>
            </div>
          </div>
          <!-- Mixed level_* string arrays -->
          <div v-else-if="Array.isArray(draft[k])" class="field">
            <label>{{ k }}</label>
            <div class="space-y-1 w-full min-w-0">
              <div
                v-for="(_x, i) in (draft[k] as unknown[])"
                :key="i"
                class="flex w-full min-w-0 gap-2 items-center">
                <InputText
                  :model-value="String((draft[k] as unknown[])[i])"
                  size="small"
                  fluid
                  class="min-w-0 flex-1 font-mono text-[11px]"
                  @update:model-value="(draft[k] as unknown[])[i] = $event" />
                <button
                  type="button"
                  class="sc-pro-btn sc-pro-btn--danger shrink-0"
                  @click="(draft[k] as unknown[]).splice(i, 1)">
                  <i class="ri-delete-bin-line"></i>
                </button>
              </div>
              <button type="button" class="sc-pro-btn" @click="(draft[k] as unknown[]).push('')">
                <i class="ri-add-line"></i>
                Add
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
